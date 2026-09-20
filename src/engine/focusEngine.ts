/*
 * Engine contract. These signatures are fixed by CLAUDE.md - do not
 * change them; P5's replay ablation and the perception adapter both
 * depend on this exact shape.
 *
 * This file (and everything else in src/engine/) is PURE TypeScript:
 * no DOM, no `window`, no `document`, no browser APIs, no `Date.now()`.
 * Timestamps always arrive as arguments.
 *
 * Single-file by request: types, default config, calibration, and the
 * FocusEngine state machine used to live in types.ts/config.ts/
 * calibrate.ts/focusEngine.ts respectively - merged here, in that same
 * order, with nothing else changed. Every import elsewhere in the repo
 * (and tools/replay.ts, which runs this file directly under Node's
 * native type-stripping) now points at this one file.
 */

export type Media = 'laptop' | 'phone' | 'book' | 'paper' | 'other'

export type FocusState = 'FOKUS' | 'TERALIH' | 'TIDAK_HADIR' | 'UNCERTAIN' | 'MENGANTUK'

export interface Frame {
  t: number // ms
  faceFound: boolean
  yaw: number | null // radians
  pitch: number | null // radians
  eyeBlink: number | null // 0..1
  objects: string[] // COCO labels seen within the last 1s
}

export interface Cone {
  yawMid: number
  yawTol: number
  pitchMid: number
  pitchTol: number
}

export interface EngineOutput {
  state: FocusState
  changedAt: number
  uncertainMs: number
}

export interface EngineConfig {
  emaAlpha: number
  toDistractedMs: number
  toFocusedMs: number
  absentMs: number
  phoneSustainMs: number
  drowsyThreshold: number
  drowsyMs: number
  coneSigmaMult: number
  coneFloorRad: number
  useDeclaredMedia: boolean
  useObjects: boolean
}

/**
 * Default engine tuning, from BUILD_PROMPTS.md P2 and PRD §5-§7.
 * `useDeclaredMedia` / `useObjects` toggling off is what powers the
 * A/B/C ablation in tools/replay.ts - see FocusEngine below.
 */
export const DEFAULT_CONFIG: EngineConfig = {
  emaAlpha: 0.25,
  toDistractedMs: 3000,
  toFocusedMs: 1500,
  absentMs: 5000,
  phoneSustainMs: 15000,
  drowsyThreshold: 0.6,
  drowsyMs: 4000,
  coneSigmaMult: 2.5,
  coneFloorRad: 0.209, // 12 degrees
  useDeclaredMedia: true,
  useObjects: true,
}

/**
 * Turn 15 seconds of "sit like you normally study" frames into a cone the
 * student's head is allowed to move within before it counts as "out of
 * cone." PRD §5:
 *   1. Discard the first 3000ms (settling).
 *   2. Mean and stddev of yaw and pitch over what's left.
 *   3. Tolerance = max(coneSigmaMult * stddev, coneFloorRad) per axis.
 *
 * The floor matters: a very still student would otherwise get an
 * impossibly tight cone and be flagged for breathing.
 */
export function calibrate(frames: Frame[], config: EngineConfig = DEFAULT_CONFIG): Cone {
  if (frames.length === 0) {
    throw new Error('calibrate: no frames provided')
  }

  const startT = frames[0]!.t
  const settled = frames.filter(
    (f) => f.t - startT >= 3000 && f.faceFound && f.yaw !== null && f.pitch !== null,
  )

  if (settled.length === 0) {
    throw new Error('calibrate: no usable frames after discarding the first 3000ms')
  }

  const yaws = settled.map((f) => f.yaw as number)
  const pitches = settled.map((f) => f.pitch as number)

  const yawMid = mean(yaws)
  const pitchMid = mean(pitches)
  const yawTol = Math.max(config.coneSigmaMult * stddev(yaws, yawMid), config.coneFloorRad)
  const pitchTol = Math.max(config.coneSigmaMult * stddev(pitches, pitchMid), config.coneFloorRad)

  return { yawMid, yawTol, pitchMid, pitchTol }
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function stddev(values: number[], m: number): number {
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

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
