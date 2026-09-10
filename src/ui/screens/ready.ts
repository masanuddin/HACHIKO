import { strings } from '../strings'
import { actions, body, button, chipGroup, el, screen, title } from '../components'
import { mascotPeek } from '../hachiko'
import { WORK_MS, WORK_DURATION_OPTIONS_MIN } from '../sessionConfig'

/**
 * A calm beat between declaring media and the timer actually starting -
 * names the chosen duration (the student picks it here), promises nothing
 * about the outcome (no streaks, no scores here either), and hands control
 * to a single button. Keeps `video` attached (same reason as media.ts) so
 * requestVideoFrameCallback doesn't stall while this screen is up.
 *
 * Resolves with the selected work duration in ms (default WORK_MS). The
 * choice is in-memory only; "Ulangi sesi" reuses it without re-showing
 * this screen.
 */
export function renderReady(root: HTMLElement, video: HTMLVideoElement): Promise<number> {
  return new Promise((resolve) => {
    const s = strings.ready
    const { root: screenEl, content } = screen()
    const defaultMin = Math.round(WORK_MS / 60_000)

    let selectedMin = defaultMin
    const titleEl = title(s.title(selectedMin))

    const { element: chips } = chipGroup(
      WORK_DURATION_OPTIONS_MIN.map((min) => ({ value: String(min), label: s.durationChip(min) })),
      {
        multi: false,
        initial: String(defaultMin),
        onChange: (values) => {
          selectedMin = values.length > 0 ? Number(values[0]) : defaultMin
          titleEl.textContent = s.title(selectedMin)
        },
      },
    )

    const startBtn = button(s.continueLabel, () => {
      root.replaceChildren()
      resolve(selectedMin * 60_000)
    })

    const hiddenVideo = el('div', { class: 'visually-hidden' }, [video])

    content.append(mascotPeek('waiting'), titleEl, body(s.body), body(s.durationLabel), chips, actions(startBtn), hiddenVideo)
    root.replaceChildren(screenEl)
  })
}
