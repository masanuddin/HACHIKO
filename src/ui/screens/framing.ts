import { strings } from '../strings'
import { actions, body, button, cameraDot, el, screen, title } from '../components'
import { startCamera, startPerceptionLoop, type PerceptionLoopHandle } from '../../perception/camera'
import { createAiRuntime } from '../../perception/aiRuntime'
import { createFaceDetector } from '../../perception/faceBox'
import type { PerceptionBundle } from '../../perception/bundle'
import { deriveCompanionState } from '../../storage/companion'
import { listSessions } from '../../storage/sessions'

// Two-tone flame, same "fill from a CSS custom property" rule as every
// Hachiko pose in hachiko.ts - amber, never red, so it reads as warmth
// rather than urgency.
const FLAME_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18">
    <path d="M12 21c-4.4 0-7-2.8-7-6.5 0-3.2 2-5 3.5-7.5C10 5 10.5 3 12 2c.3 2.5-.5 4-.2 6 .3 2 2.2 2.5 2.2 4.5 0-1.5 1-2 1-3.5 1.5 1.5 3 4 3 6 0 3.7-2.6 6.5-6 6.5Z" fill="var(--amber)" />
    <path d="M12 21c-2.2 0-3.5-1.6-3.5-3.7 0-1.6 1-2.6 1.7-3.8.3.8.2 1.7 1 2.2.1-1 .6-1.4.9-2.2.7 1 1.4 2.2 1.4 3.4 0 2.3-1.3 4.1-1.5 4.1Z" fill="var(--amber-deep)" />
  </svg>
`

/**
 * The same quiet, positive-only "Hachiko remembers you" greeting from
 * the design - a pill chip instead of a bare paragraph. The flame only
 * appears once a streak is genuinely building (>=2 days).
 */
function streakChip(sessionCount: number, streakDays: number): HTMLDivElement {
  const s = strings.framing
  let text = s.companionSessionCount(sessionCount)
  const chip = el('div', { class: 'streak-chip' })
  if (streakDays >= 2) {
    const flame = el('span', { class: 'streak-chip__flame' })
    flame.innerHTML = FLAME_SVG
    chip.append(flame)
    text += s.companionStreak(streakDays)
  }
  chip.append(el('span', {}, [text]))
  return chip
}

export interface FramingResult {
  bundle: PerceptionBundle
  video: HTMLVideoElement
}

export function renderFraming(root: HTMLElement): Promise<FramingResult> {
  return new Promise((resolve) => {
    const s = strings.framing
    const { root: screenEl, content } = screen()

    const status = body(s.permissionPending)
    const preview = el('div', { class: 'camera-preview' })
    const video = el('video', {})
    const targetBox = el('div', { class: 'camera-preview__target' })
    preview.append(video, targetBox)

    const dot = cameraDot(strings.common.cameraActive)
    dot.style.visibility = 'hidden'

    let bundle: PerceptionBundle | null = null
    let loop: PerceptionLoopHandle | null = null

    const continueBtn = button(
      s.continueLabel,
      () => {
        if (!bundle) return
        loop?.stop()
        root.replaceChildren()
        resolve({ bundle, video })
      },
      { disabled: true },
    )

    content.append(title(s.title), status, preview, actions(continueBtn), dot)

    // A quiet, positive-only "Hachiko remembers you" note - never
    // mentions a broken streak, only ever a session count and (once
    // genuinely building) a streak. Framing is the real "returning
    // student" entry point (Welcome only shows once), so this is the
    // one place that greeting can land.
    const companion = deriveCompanionState(listSessions(), Date.now())
    if (companion.totalSessions >= 1) {
      content.append(streakChip(companion.totalSessions, companion.currentStreakDays))
    }

    root.replaceChildren(screenEl)

    void (async () => {
      try {
        const camera = await startCamera(video)
        dot.style.visibility = 'visible'
        status.textContent = s.body

        const [aiRuntime, faceDetector] = await Promise.all([createAiRuntime(), createFaceDetector()])
        bundle = { camera, ...aiRuntime, faceDetector }

        // Slower than the default 5fps: this screen only checks
        // faceFound to enable Continue, nothing time-sensitive, and
        // detectForVideo runs synchronously - at the default rate its
        // periodic blocking was visible as stutter in the live preview.
        // Session.ts never shows the preview at all, so its own
        // detection rate is untouched.
        loop = startPerceptionLoop(
          video,
          aiRuntime.ai,
          aiRuntime.faceEngine,
          aiRuntime.objectEngine,
          (tick) => {
            continueBtn.disabled = !tick.frame.faceFound
          },
          1000,
        )
      } catch (err) {
        status.textContent =
          err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
            ? s.permissionDenied
            : s.permissionError
        console.error(err)
      }
    })()
  })
}
