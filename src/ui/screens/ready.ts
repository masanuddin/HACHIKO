import { strings, formatDuration } from '../strings'
import {
  actions,
  button,
  cameraDot,
  card,
  chipGroup,
  disclosure,
  el,
  screen,
  stepper,
  titleWithDoodle,
} from '../components'
import { startCamera, startPerceptionLoop, type PerceptionLoopHandle } from '../../perception/camera'
import { createFaceLandmarker } from '../../perception/face'
import { createObjectDetector } from '../../perception/objects'
import { createFaceDetector } from '../../perception/faceBox'
import type { PerceptionBundle } from '../../perception/bundle'
import { deriveCompanionState } from '../../storage/companion'
import { listSessions } from '../../storage/sessions'
import type { Media } from '../../engine/types'
import {
  WORK_MS,
  WORK_DURATION_OPTIONS_MIN,
  FAST_DEBUG_WORK_MS,
  ROUNDS_PER_SET_OPTIONS,
  DEFAULT_ROUNDS_PER_SET,
  BREAK_MS,
  LONG_BREAK_MS,
  FAST_DEBUG_BREAK_MS,
  FAST_DEBUG_LONG_BREAK_MS,
  BREAK_MAX_RATIO,
  LONG_BREAK_MAX_RATIO,
  DURATION_MIN_MS,
  DURATION_MAX_MS,
  maxBreakMs,
  buildTimelinePreview,
  isFastDebugMode,
} from '../sessionConfig'

const MEDIA_OPTIONS: { value: Media; labelKey: keyof typeof strings.media.chips }[] = [
  { value: 'laptop', labelKey: 'laptop' },
  { value: 'phone', labelKey: 'phone' },
  { value: 'book', labelKey: 'book' },
  { value: 'paper', labelKey: 'paper' },
  { value: 'mixed', labelKey: 'mixed' },
  { value: 'other', labelKey: 'other' },
]

// Two-tone flame, same "fill from a CSS custom property" rule as every
// Hachiko pose - amber, never red, so it reads as warmth rather than
// urgency.
const FLAME_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18">
    <path d="M12 21c-4.4 0-7-2.8-7-6.5 0-3.2 2-5 3.5-7.5C10 5 10.5 3 12 2c.3 2.5-.5 4-.2 6 .3 2 2.2 2.5 2.2 4.5 0-1.5 1-2 1-3.5 1.5 1.5 3 4 3 6 0 3.7-2.6 6.5-6 6.5Z" fill="var(--amber)" />
    <path d="M12 21c-2.2 0-3.5-1.6-3.5-3.7 0-1.6 1-2.6 1.7-3.8.3.8.2 1.7 1 2.2.1-1 .6-1.4.9-2.2.7 1 1.4 2.2 1.4 3.4 0 2.3-1.3 4.1-1.5 4.1Z" fill="var(--amber-deep)" />
  </svg>
`

/**
 * The same quiet, positive-only "Hachiko remembers you" greeting from
 * the original Framing screen - a pill chip instead of a bare
 * paragraph. The flame only appears once a streak is genuinely
 * building (>=2 days).
 */
function streakChip(sessionCount: number, streakDays: number): HTMLDivElement {
  const s = strings.framing
  let text = s.companionSessionCount(sessionCount)
  const chip = el('div', { class: 'streak-chip ready-grid__streak' })
  if (streakDays >= 2) {
    const flame = el('span', { class: 'streak-chip__flame' })
    flame.innerHTML = FLAME_SVG
    chip.append(flame)
    text += s.companionStreak(streakDays)
  }
  chip.append(el('span', {}, [text]))
  return chip
}

/**
 * A one-time, purely informational preview of what one full set looks
 * like under the chosen durations/rounds - shown when "Mulai" is
 * tapped, before advancing to Calibration. Not a commitment: dismissing
 * it just starts the session exactly as tapping "Mulai" always has;
 * the multi-cycle "Fokus lagi?" loop (session.ts) still asks after
 * every real break, indefinitely, unchanged.
 */
function timelinePreviewCard(
  workMs: number,
  breakMs: number,
  longBreakMs: number,
  rounds: number,
  onContinue: () => void,
): HTMLDivElement {
  const s = strings
  const items = buildTimelinePreview(workMs, breakMs, longBreakMs, rounds)
  const row = el('div', { class: 'timeline-preview__row' })
  items.forEach((item, i) => {
    const label =
      item.kind === 'work'
        ? s.session.stateLabels.FOKUS
        : item.kind === 'longBreak'
          ? s.ready.timelineLongBreakLabel
          : s.ready.timelineBreakLabel
    const tone = item.kind === 'work' ? 'work' : item.kind === 'longBreak' ? 'long-break' : 'break'
    row.append(el('span', { class: `timeline-pill timeline-pill--${tone}` }, [`${label} ${formatDuration(item.ms)}`]))
    if (i < items.length - 1) {
      row.append(el('span', { class: 'timeline-preview__arrow', 'aria-hidden': 'true' }, ['→']))
    }
  })

  return card(
    el('h2', { class: 'card__title' }, [s.ready.timelineTitle]),
    row,
    actions(button(s.common.continueLabel, onContinue)),
  )
}

export interface ReadySetupResult {
  bundle: PerceptionBundle
  video: HTMLVideoElement
  declaredMedia: Media[]
  workMs: number
  rounds: number
  breakMs: number
  longBreakMs: number
  /** Where the camera preview sat on screen right before this screen
   * was torn down - Calibration uses this to visually expand into
   * place instead of a plain cut. See src/ui/transition.ts. */
  cameraRect: DOMRect
}

/**
 * The merged camera-check + study-material + duration + rounds screen
 * (2026-09-17 design spec). Replaces the old Framing, Media, and Ready
 * screens - this is the only one of the three that still requests
 * camera permission and builds the PerceptionBundle; everything
 * downstream (Calibration onward) still receives the same `bundle` and
 * `video` by reference as before.
 */
export function renderReady(root: HTMLElement): Promise<ReadySetupResult> {
  return new Promise((resolve) => {
    const s = strings
    const { root: screenEl, content } = screen()
    // .screen__content's default max-width (720px, tokens.css) is sized
    // for every other screen's single-column text - this screen's
    // 2-column bento grid (camera + steppers) needs more room, or it
    // sits as a narrow strip in the middle of a wide viewport.
    content.classList.add('screen__content--wide')

    const status = el('p', { class: 'note' }, [s.framing.permissionPending])
    const preview = el('div', { class: 'camera-preview' })
    const video = el('video', {})
    const targetBox = el('div', { class: 'camera-preview__target' })
    preview.append(video, targetBox)

    const dot = cameraDot(s.common.cameraActive)
    dot.style.visibility = 'hidden'

    const cameraTile = el('div', { class: 'bento-tile bento-tile--plain ready-grid__camera' }, [status, preview, dot])

    let bundle: PerceptionBundle | null = null
    let loop: PerceptionLoopHandle | null = null

    // --- Short/long break steppers (collapsed behind a disclosure) ---
    // Constructed BEFORE the work-duration stepper below: every
    // `stepper()` call invokes its own `onChange` once synchronously
    // during construction (see Task 2's `apply(valueMs)` at the end of
    // the function), and the work stepper's `onChange` calls back into
    // these two immediately - they must already exist by then, or this
    // throws "Cannot access before initialization".
    let breakMs = BREAK_MS
    let longBreakMs = LONG_BREAK_MS
    const shortBreakStepper = stepper({
      label: s.ready.shortBreakLabel,
      initialMs: breakMs,
      minMs: DURATION_MIN_MS,
      maxMs: maxBreakMs(WORK_MS, BREAK_MAX_RATIO),
      presetsMs: [BREAK_MS, ...(isFastDebugMode() ? [FAST_DEBUG_BREAK_MS] : [])],
      onChange: (ms) => {
        breakMs = ms
      },
    })
    const longBreakStepper = stepper({
      label: s.ready.longBreakLabel,
      initialMs: longBreakMs,
      minMs: DURATION_MIN_MS,
      maxMs: maxBreakMs(WORK_MS, LONG_BREAK_MAX_RATIO),
      presetsMs: [LONG_BREAK_MS, ...(isFastDebugMode() ? [FAST_DEBUG_LONG_BREAK_MS] : [])],
      onChange: (ms) => {
        longBreakMs = ms
      },
    })
    const breakSettings = disclosure(s.ready.breakSettingsLabel, [shortBreakStepper.element, longBreakStepper.element])

    // --- Work duration stepper ---
    let workMs = WORK_MS
    const workPresets = [
      ...WORK_DURATION_OPTIONS_MIN.map((min) => min * 60_000),
      ...(isFastDebugMode() ? [FAST_DEBUG_WORK_MS] : []),
    ]
    const workStepper = stepper({
      label: s.ready.durationLabel,
      initialMs: workMs,
      minMs: DURATION_MIN_MS,
      maxMs: DURATION_MAX_MS,
      presetsMs: workPresets,
      onChange: (ms) => {
        workMs = ms
        shortBreakStepper.setMax(maxBreakMs(workMs, BREAK_MAX_RATIO))
        longBreakStepper.setMax(maxBreakMs(workMs, LONG_BREAK_MAX_RATIO))
      },
    })

    // --- Rounds-per-set (unchanged preset-chip picker, just repositioned) ---
    let selectedRounds = DEFAULT_ROUNDS_PER_SET
    const { element: roundsChips } = chipGroup(
      ROUNDS_PER_SET_OPTIONS.map((n) => ({ value: String(n), label: s.ready.roundsChip(n) })),
      {
        multi: false,
        initial: String(selectedRounds),
        onChange: (values) => {
          selectedRounds = values.length > 0 ? Number(values[0]) : DEFAULT_ROUNDS_PER_SET
        },
      },
    )
    const roundsTile = el('div', { class: 'bento-tile bento-tile--sage-tint ready-grid__rounds' }, [
      el('span', { class: 'metric__label' }, [s.ready.roundsLabel]),
      roundsChips,
      breakSettings.element,
    ])

    // --- Media (unchanged multi-select chips + inline required error) ---
    const mediaError = el('p', { class: 'field__error' }, [''])
    mediaError.style.display = 'none'
    const { element: mediaChips, getSelected: getSelectedMedia } = chipGroup(
      MEDIA_OPTIONS.map((o) => ({ value: o.value, label: s.media.chips[o.labelKey] })),
      { multi: true },
    )
    const mediaTile = el('div', { class: 'bento-tile ready-grid__media' }, [
      el('span', { class: 'metric__label' }, [s.media.title]),
      mediaChips,
      mediaError,
    ])

    const durationTile = el('div', { class: 'bento-tile bento-tile--amber-tint ready-grid__duration' }, [
      workStepper.element,
    ])

    // --- Submit: hard-gated on camera+face (button stays disabled until
    // then, matching the old Framing screen's gate exactly); media is a
    // soft gate (inline error on click, matching the old Media screen).
    // Tapping "Mulai" doesn't advance straight to Calibration - it swaps
    // this row for a one-time timeline preview first (see
    // timelinePreviewCard above); the grid above stays exactly as it is,
    // so the camera tile's on-screen position (and the cameraRect the
    // Calibration expand-transition reads) doesn't shift underneath it. ---
    const continueBtn = button(
      s.ready.continueLabel,
      () => {
        if (!bundle) return
        // TS can't narrow a captured outer `let` across the nested
        // `finish` closure below (it's conservative about reassignment
        // between now and whenever finish() actually runs) - a local
        // const carries the non-null type through instead.
        const readyBundle = bundle
        const declaredMedia = getSelectedMedia() as Media[]
        if (declaredMedia.length === 0) {
          mediaError.textContent = s.media.requiredError
          mediaError.style.display = 'block'
          return
        }
        const finish = () => {
          loop?.stop()
          const cameraRect = preview.getBoundingClientRect()
          root.replaceChildren()
          resolve({
            bundle: readyBundle,
            video,
            declaredMedia,
            workMs,
            rounds: selectedRounds,
            breakMs,
            longBreakMs,
            cameraRect,
          })
        }
        // .screen__actions--end's justify-content:flex-end suited a lone
        // right-aligned button; the preview card should fill the row.
        // (Named previewCard, not preview - `preview` is already the
        // camera-preview element finish() reads getBoundingClientRect()
        // from; shadowing it here would silently break the FLIP
        // transition's rect capture.)
        ctaRow.classList.remove('screen__actions--end')
        const previewCard = timelinePreviewCard(workMs, breakMs, longBreakMs, selectedRounds, finish)
        previewCard.style.flex = '1'
        ctaRow.replaceChildren(previewCard)
      },
      { disabled: true },
    )

    const grid = el('div', { class: 'ready-grid' }, [cameraTile, durationTile, roundsTile, mediaTile])

    const ctaRow = actions(continueBtn)
    ctaRow.classList.add('screen__actions--end')
    content.append(titleWithDoodle(s.framing.title), grid, ctaRow)

    root.replaceChildren(screenEl)

    // The streak chip is prepended into the grid (not built in above)
    // once we know whether it should show at all. If it doesn't, the
    // grid simply has an empty row 1 rather than reflowing everything
    // else - that only ever happens on a student's very first-ever
    // session.

    const companion = deriveCompanionState(listSessions(), Date.now())
    if (companion.totalSessions >= 1) {
      grid.prepend(streakChip(companion.totalSessions, companion.currentStreakDays))
    }

    void (async () => {
      try {
        const camera = await startCamera(video)
        dot.style.visibility = 'visible'
        // Stays visible for the rest of this screen's lifetime, same as
        // the old Framing screen - it's the only thing on screen that
        // explains why "Mulai" is greyed out until a face is framed.
        status.textContent = s.framing.body

        const [faceLandmarker, objectDetector, faceDetector] = await Promise.all([
          createFaceLandmarker(),
          createObjectDetector(),
          createFaceDetector(),
        ])
        bundle = { camera, faceLandmarker, objectDetector, faceDetector }

        // Same slower-than-default rate as the old Framing screen: this
        // screen only checks faceFound to enable the button, nothing
        // time-sensitive, and detectForVideo runs synchronously - at the
        // default rate its periodic blocking was visible as stutter in
        // the live preview.
        loop = startPerceptionLoop(video, faceLandmarker, objectDetector, (tick) => {
          if (tick.face) continueBtn.disabled = !tick.face.faceFound
        }, 1000)
      } catch (err) {
        status.textContent =
          err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
            ? s.framing.permissionDenied
            : s.framing.permissionError
        console.error(err)
      }
    })()
  })
}
