import type { Cone, EngineConfig, EngineOutput, Frame, FocusState, Media } from './types'

const PHONE_LABEL = 'cell phone'

/**
 * The state machine. Implements PRD §5 (smoothing, drowsiness, absence)
 * and §7 (the decision table). Pure TypeScript - see CLAUDE.md constraint
 * 4. All timestamps come from `Frame.t`; nothing here reads a clock.
 *
 * Precedence per step(), highest first:
 *   1. Absence (no face for absentMs)          -> TIDAK_HADIR
 *   2. Drowsiness (sustained eye closure)       -> MENGANTUK
 *   3. The §7 decision table                    -> FOKUS / TERALIH / UNCERTAIN
 *
 * ## Two spec resolutions made explicit here (confirmed with the team)
 *
 * a) PRD §7 prints `Laptop · out of cone · — · UNCERTAIN`, which reads as
 *    contradicting the Buku row directly above it (`out of cone · phone
 *    seen · TERALIH`). The `—` is table shorthand, not a special case:
 *    the uniform rule is "a sustained phone means TERALIH whenever
 *    declared media does not include phone," laptop included. This also
 *    matches BUILD_PROMPTS P2's own stated key rule.
 *
 * b) `'other'` (Lainnya) is not in the §7 table. It is treated as
 *    not-phone-declared, same as book/paper/laptop.
 *
 * ## The "no declaration" fallback (BUILD_PROMPTS P2 tests b-e)
 *
 * The context layer (declared media + objects) has nothing to fuse when
 * `declaredMedia` is empty or `useDeclaredMedia` is off - there is no
 * declaration to check a detected object against. In that case the
 * engine falls back to the naive visual-only mapping the team's pilot
 * measured in the first place: in cone -> FOKUS, out of cone -> TERALIH,
 * no UNCERTAIN. This is also ablation System A (PRD §11). The moment a
 * declaration exists, "out of cone" becomes something the system must
 * abstain on rather than guess at, unless a sustained phone resolves it.
 */
// Beyond this many ms since the previous step(), a gap is treated as a
// stall (the caller paused, the tab was backgrounded, a GC pause, etc.)
// rather than continuously-elapsed time in whatever state was last
// measured - see the "does not attribute a large frame-timestamp gap"
// test. Frame.t comes from performance.now() (camera.ts), which keeps
// advancing through any such stall even though step() itself may not be
// called again until it ends, so a real gap and a single slow frame are
// indistinguishable except by magnitude: normal inter-frame dt is at
// most tens of ms, so this cap has wide margin without needing to be
// tuned to any particular frame rate.
const MAX_PLAUSIBLE_DT_MS = 1000

export class FocusEngine {
  private lastT: number | null = null

  private absentAccumMs = 0
  private drowsyAccumMs = 0
  private phoneAccumMs = 0

  private emaYaw: number | null = null
  private emaPitch: number | null = null

  /** Debounced cone membership - what the hysteresis in §5 gates. */
  private debouncedInCone = false
  private inAccumMs = 0
  private outAccumMs = 0

  private reportedState: FocusState | null = null
  private changedAt = 0
  private uncertainMs = 0

  private readonly cfg: EngineConfig
  private readonly cone: Cone
  private readonly declaredMedia: Media[]
  private readonly declaredIncludesPhone: boolean

  // Plain fields assigned in the body, not TS constructor-parameter
  // shorthand - tools/replay.ts runs this file directly under Node's
  // native type-stripping, which doesn't support that shorthand.
  constructor(cfg: EngineConfig, cone: Cone, declaredMedia: Media[]) {
    this.cfg = cfg
    this.cone = cone
    this.declaredMedia = declaredMedia
    this.declaredIncludesPhone = declaredMedia.includes('phone')
  }

  reset(): void {
    this.lastT = null
    this.absentAccumMs = 0
    this.drowsyAccumMs = 0
    this.phoneAccumMs = 0
    this.emaYaw = null
    this.emaPitch = null
    this.debouncedInCone = false
    this.inAccumMs = 0
    this.outAccumMs = 0
    this.reportedState = null
    this.changedAt = 0
    this.uncertainMs = 0
  }

  step(f: Frame): EngineOutput {
    const rawDt = this.lastT === null ? 0 : Math.max(0, f.t - this.lastT)
    const dt = rawDt > MAX_PLAUSIBLE_DT_MS ? 0 : rawDt
    this.lastT = f.t

    let state: FocusState

    if (!f.faceFound) {
      // Can't measure blink or head pose without a face - freeze those
      // reads rather than guessing, but absence itself keeps counting.
      this.drowsyAccumMs = 0
      this.phoneAccumMs = 0
      this.absentAccumMs += dt

      state = this.absentAccumMs >= this.cfg.absentMs ? 'TIDAK_HADIR' : (this.reportedState ?? 'UNCERTAIN')
    } else {
      this.absentAccumMs = 0

      if (f.eyeBlink !== null && f.eyeBlink >= this.cfg.drowsyThreshold) {
        this.drowsyAccumMs += dt
      } else {
        this.drowsyAccumMs = 0
      }

      this.updatePhoneAccumulator(f, dt)
      this.updateCone(f, dt)

      state = this.drowsyAccumMs >= this.cfg.drowsyMs ? 'MENGANTUK' : this.decide()
    }

    if (state === 'UNCERTAIN') {
      this.uncertainMs += dt
    }

    return this.report(state, f.t)
  }

  private updatePhoneAccumulator(f: Frame, dt: number): void {
    const phoneVisible = this.cfg.useObjects && f.objects.includes(PHONE_LABEL)
    this.phoneAccumMs = phoneVisible ? this.phoneAccumMs + dt : 0
  }

  private updateCone(f: Frame, dt: number): void {
    if (f.yaw === null || f.pitch === null) return

    this.emaYaw = this.emaYaw === null ? f.yaw : this.cfg.emaAlpha * f.yaw + (1 - this.cfg.emaAlpha) * this.emaYaw
    this.emaPitch =
      this.emaPitch === null ? f.pitch : this.cfg.emaAlpha * f.pitch + (1 - this.cfg.emaAlpha) * this.emaPitch

    const rawInCone =
      Math.abs(this.emaYaw - this.cone.yawMid) <= this.cone.yawTol &&
      Math.abs(this.emaPitch - this.cone.pitchMid) <= this.cone.pitchTol

    // Asymmetric hysteresis (PRD §5): distraction is hard to trigger,
    // recovery is easy. toDistractedMs is roughly double toFocusedMs.
    if (this.debouncedInCone) {
      if (rawInCone) {
        this.outAccumMs = 0
      } else {
        this.outAccumMs += dt
        if (this.outAccumMs >= this.cfg.toDistractedMs) {
          this.debouncedInCone = false
          this.outAccumMs = 0
          this.inAccumMs = 0
        }
      }
    } else {
      if (!rawInCone) {
        this.inAccumMs = 0
      } else {
        this.inAccumMs += dt
        if (this.inAccumMs >= this.cfg.toFocusedMs) {
          this.debouncedInCone = true
          this.inAccumMs = 0
          this.outAccumMs = 0
        }
      }
    }
  }

  /** The §7 decision table, precedence-resolved per the header comment. */
  private decide(): FocusState {
    const hasDeclaration = this.cfg.useDeclaredMedia && this.declaredMedia.length > 0

    if (!hasDeclaration) {
      return this.debouncedInCone ? 'FOKUS' : 'TERALIH'
    }

    const phoneSustained = this.cfg.useObjects && this.phoneAccumMs >= this.cfg.phoneSustainMs

    if (phoneSustained && !this.declaredIncludesPhone) {
      return 'TERALIH'
    }

    // Never coerce ambiguity into FOKUS or TERALIH: with a declaration in
    // play but no disambiguating object, "out of cone" abstains.
    return this.debouncedInCone ? 'FOKUS' : 'UNCERTAIN'
  }

  private report(state: FocusState, t: number): EngineOutput {
    if (state !== this.reportedState) {
      this.reportedState = state
      this.changedAt = t
    }

    return { state, changedAt: this.changedAt, uncertainMs: this.uncertainMs }
  }
}
