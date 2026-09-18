import type { FocusState } from '../engine/types'

/**
 * Hachiko, six illustrated poses (PRD §4, §9; BUILD_PROMPTS P3), sourced
 * from user-supplied artwork under public/mascot/ (cropped from a
 * hand-picked sticker sheet, not generated here). Behind the single
 * `HachikoView` interface below so a future art pass can swap files
 * without touching src/ui/screens/session.ts.
 */

export type HachikoPose = 'sleeping' | 'stirring' | 'waking' | 'waiting' | 'drowsy' | 'celebrating'

/**
 * Five FocusState values map onto five poses. UNCERTAIN and TIDAK_HADIR
 * share "waiting" - a curious, unbothered posture - deliberately, since
 * neither state is a verdict the dog should look alarmed about.
 *
 * `stirring` is not driven by FocusState at all - it's a presentation-
 * only foreshadow (see src/ui/pacing.ts's isRawOutOfCone) shown while
 * the engine still reports FOKUS but a possible drift is brewing, so a
 * kid who drifts often and self-corrects gets a soft early cue instead
 * of nothing then a sudden full wake. `stirring` is true only while the
 * caller has independently decided to show it; this function never
 * infers it from state alone.
 */
export function poseForState(state: FocusState, stirring = false): HachikoPose {
  if (state === 'FOKUS' && stirring) return 'stirring'

  switch (state) {
    case 'FOKUS':
      return 'sleeping'
    case 'TERALIH':
      return 'waking'
    case 'MENGANTUK':
      return 'drowsy'
    case 'TIDAK_HADIR':
    case 'UNCERTAIN':
      return 'waiting'
  }
}

const ARIA_LABEL: Record<HachikoPose, string> = {
  sleeping: 'Hachiko sedang tidur',
  stirring: 'Hachiko mulai terusik',
  waking: 'Hachiko terbangun',
  waiting: 'Hachiko menunggu dengan tenang',
  drowsy: 'Hachiko mulai mengantuk',
  celebrating: 'Hachiko ikut senang merayakan pencapaianmu',
}

/**
 * Deliberately excludes the sheet's "crying" sticker - it doesn't map to
 * any pose here. A sad-Hachiko reacting to TIDAK_HADIR or an early stop
 * would read as guilt over something that's often completely innocuous
 * (a bathroom break, an early end), which is exactly what this product
 * argues against (see the `waiting` comment above).
 */
const POSE_IMAGE: Record<HachikoPose, string> = {
  sleeping: '/mascot/sleeping.png',
  stirring: '/mascot/stirring.png',
  waking: '/mascot/waking.png',
  waiting: '/mascot/waiting.png',
  drowsy: '/mascot/drowsy.png',
  celebrating: '/mascot/celebrating.png',
}

function poseImg(pose: HachikoPose, extraClass = ''): HTMLImageElement {
  const img = document.createElement('img')
  img.src = POSE_IMAGE[pose]
  img.alt = ''
  img.className = `hachiko-pose${pose === 'sleeping' ? ' hachiko-sleep' : ''}${extraClass ? ` ${extraClass}` : ''}`
  return img
}

/**
 * A small, static, decorative Hachiko for screens before the session
 * starts (welcome, consent, ready, session card) - the mascot otherwise
 * doesn't appear until S6, leaving every onboarding screen as plain
 * text and buttons. `aria-hidden` because this is decoration, not a
 * status readout; the screen's own title and body already carry the
 * meaning for a screen-reader user.
 */
export function mascotPeek(pose: HachikoPose = 'sleeping'): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = 'mascot-peek'
  wrap.setAttribute('aria-hidden', 'true')
  wrap.append(poseImg(pose))
  return wrap
}

// 16 individually-exported frames (public/mascot/walking/), not one
// composited sprite sheet - cycled via plain setInterval below rather
// than a CSS steps() background-position animation, since there's no
// single sheet image for steps() to slice.
const WALKING_FRAME_COUNT = 16
const WALKING_FRAME_INTERVAL_MS = 120 // ~8fps - smooth enough for a small decorative loop

function walkingFrameSrc(n: number): string {
  return `/mascot/walking/frame-${String(n).padStart(2, '0')}.png`
}

/**
 * A small looping walk animation - Hachiko in a graduation cap - used
 * on the Calibration screen while the student waits. Distinct from the
 * six FocusState-driven poses above: purely decorative, no bearing on
 * focus state, and not part of `poseForState`'s mapping. `aria-hidden`
 * for the same reason `mascotPeek` is. The caller must call the
 * returned `stop()` when the screen tears down or swaps to a different
 * mascot, or the interval keeps writing to a detached <img> forever.
 */
export function walkingMascot(): { element: HTMLDivElement; stop: () => void } {
  const wrap = document.createElement('div')
  wrap.className = 'mascot-peek'
  wrap.setAttribute('aria-hidden', 'true')
  const img = document.createElement('img')
  img.className = 'hachiko-pose'
  img.alt = ''
  img.src = walkingFrameSrc(1)
  wrap.append(img)

  let frame = 1
  const interval = window.setInterval(() => {
    frame = (frame % WALKING_FRAME_COUNT) + 1
    img.src = walkingFrameSrc(frame)
  }, WALKING_FRAME_INTERVAL_MS)

  return { element: wrap, stop: () => window.clearInterval(interval) }
}

export class HachikoView {
  readonly element: HTMLDivElement
  private currentPose: HachikoPose | null = null

  constructor() {
    this.element = document.createElement('div')
    this.element.className = 'session__hachiko'
  }

  setState(state: FocusState, stirring = false): void {
    const pose = poseForState(state, stirring)
    if (pose === this.currentPose) return
    this.currentPose = pose
    this.render(pose)
  }

  private render(pose: HachikoPose): void {
    const img = poseImg(pose, 'hachiko-pose--enter')
    img.setAttribute('role', 'img')
    img.alt = ARIA_LABEL[pose]
    this.element.replaceChildren(img)

    // Swapping in a fresh <img> has nothing to interpolate from on its
    // own - it starts in the --enter state for one frame, then this
    // drops it so base.css's transition on .hachiko-pose actually plays
    // the spring-in rather than jumping straight to rest.
    requestAnimationFrame(() => img.classList.remove('hachiko-pose--enter'))
  }
}
