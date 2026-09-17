import { strings, formatDuration } from '../strings'
import { actions, body, button, chipGroup, doodleSlot, el, screen, title } from '../components'
import { mascotPeek } from '../hachiko'
import {
  WORK_MS,
  WORK_DURATION_OPTIONS_MIN,
  FAST_DEBUG_WORK_MS,
  ROUNDS_PER_SET_OPTIONS,
  DEFAULT_ROUNDS_PER_SET,
  isFastDebugMode,
} from '../sessionConfig'

export interface ReadyChoice {
  workMs: number
  rounds: number
}

/**
 * A calm beat between declaring media and the timer actually starting -
 * names the chosen duration (the student picks it here), promises nothing
 * about the outcome (no streaks, no scores here either), and hands control
 * to a single button. Keeps `video` attached (same reason as media.ts) so
 * requestVideoFrameCallback doesn't stall while this screen is up.
 *
 * Both choices are in-memory only and reused for every cycle across a
 * multi-cycle sitting (the Break screen's "Fokus lagi" loop), without
 * ever re-showing this screen: the work duration for every round, and
 * `rounds` for how many rounds happen before a long break (see
 * DEFAULT_ROUNDS_PER_SET in sessionConfig.ts) - without a cap here the
 * Break screen's loop could otherwise repeat forever with only ever a
 * short break in between.
 */
export function renderReady(root: HTMLElement, video: HTMLVideoElement): Promise<ReadyChoice> {
  return new Promise((resolve) => {
    const s = strings.ready
    const { root: screenEl, content } = screen()

    // ?fastdebug appends a 30-second option to the normal 15/25/50 menit
    // chips - invisible without that query param (see sessionConfig.ts).
    const optionsMs = [
      ...WORK_DURATION_OPTIONS_MIN.map((min) => min * 60_000),
      ...(isFastDebugMode() ? [FAST_DEBUG_WORK_MS] : []),
    ]

    let selectedMs = WORK_MS
    let selectedRounds = DEFAULT_ROUNDS_PER_SET
    const titleEl = title(s.title(formatDuration(selectedMs)))

    const { element: chips } = chipGroup(
      optionsMs.map((ms) => ({ value: String(ms), label: formatDuration(ms) })),
      {
        multi: false,
        initial: String(selectedMs),
        onChange: (values) => {
          selectedMs = values.length > 0 ? Number(values[0]) : WORK_MS
          titleEl.textContent = s.title(formatDuration(selectedMs))
        },
      },
    )

    const { element: roundsChips } = chipGroup(
      ROUNDS_PER_SET_OPTIONS.map((n) => ({ value: String(n), label: s.roundsChip(n) })),
      {
        multi: false,
        initial: String(selectedRounds),
        onChange: (values) => {
          selectedRounds = values.length > 0 ? Number(values[0]) : DEFAULT_ROUNDS_PER_SET
        },
      },
    )

    const startBtn = button(s.continueLabel, () => {
      root.replaceChildren()
      resolve({ workMs: selectedMs, rounds: selectedRounds })
    })

    const hiddenVideo = el('div', { class: 'visually-hidden' }, [video])

    content.append(
      mascotPeek('waiting'),
      el('div', { class: 'title-row' }, [titleEl, doodleSlot('doodle')]),
      body(s.body),
      body(s.durationLabel),
      chips,
      body(s.roundsLabel),
      roundsChips,
      actions(startBtn),
      hiddenVideo,
    )
    root.replaceChildren(screenEl)
  })
}
