import { strings } from '../strings'
import { actions, body, button, chipGroup, el, screen, title } from '../components'
import { mascotPeek } from '../hachiko'
import { WORK_MS, WORK_DURATION_OPTIONS_MIN, CYCLE_COUNT_OPTIONS, DEFAULT_CYCLE_COUNT } from '../sessionConfig'

/**
 * A calm beat between declaring media and the timer actually starting -
 * names the chosen duration and cycle count (the student picks both
 * here), promises nothing about the outcome (no streaks, no scores here
 * either), and hands control to a single button. Keeps `video` attached
 * (same reason as media.ts) so requestVideoFrameCallback doesn't stall
 * while this screen is up.
 *
 * Resolves with the selected work duration (default WORK_MS) and cycle
 * count (default DEFAULT_CYCLE_COUNT). Both are in-memory only; "Ulangi
 * sesi" reuses them without re-showing this screen.
 */
export interface ReadyChoice {
  workMs: number
  cycleCount: number
}

export function renderReady(root: HTMLElement, video: HTMLVideoElement): Promise<ReadyChoice> {
  return new Promise((resolve) => {
    const s = strings.ready
    const { root: screenEl, content } = screen()
    const defaultMin = Math.round(WORK_MS / 60_000)

    let selectedMin = defaultMin
    let selectedCycles = DEFAULT_CYCLE_COUNT
    const titleEl = title(s.title(selectedMin))

    const { element: durationChips } = chipGroup(
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

    const { element: cycleChips } = chipGroup(
      CYCLE_COUNT_OPTIONS.map((n) => ({ value: String(n), label: s.cycleChip(n) })),
      {
        multi: false,
        initial: String(DEFAULT_CYCLE_COUNT),
        onChange: (values) => {
          selectedCycles = values.length > 0 ? Number(values[0]) : DEFAULT_CYCLE_COUNT
        },
      },
    )

    const startBtn = button(s.continueLabel, () => {
      root.replaceChildren()
      resolve({ workMs: selectedMin * 60_000, cycleCount: selectedCycles })
    })

    const hiddenVideo = el('div', { class: 'visually-hidden' }, [video])

    content.append(
      mascotPeek('waiting'),
      titleEl,
      body(s.body),
      body(s.durationLabel),
      durationChips,
      body(s.cycleLabel),
      cycleChips,
      actions(startBtn),
      hiddenVideo,
    )
    root.replaceChildren(screenEl)
  })
}
