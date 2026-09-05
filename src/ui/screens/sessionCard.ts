import { strings, formatMinutes, formatMinSec } from '../strings'
import { actions, body, button, card, el, screen, title } from '../components'
import { computeMetrics, type SessionRecord } from '../../storage/sessions'
import { downloadJsonl } from '../../storage/telemetry'
import { mascotPeek } from '../hachiko'
import type { Milestone } from '../../storage/companion'

// Retunable if the pace feels wrong in practice - not a structural
// constant. Longer than Clarify's since there's more to read here
// (metrics, observation, a possible milestone).
const AUTO_CLOSE_MS = 20_000

/**
 * One plain observation, never a judgment (PRD §8, BUILD_PROMPTS P4).
 * "Fokusmu paling kuat di 12 menit pertama." is right.
 * "Kamu terdistraksi 8 kali." is wrong - this function never counts
 * distractions, only describes where the strong early stretch was.
 */
function observation(firstCollapseAtMs: number | null): string {
  if (firstCollapseAtMs === null) {
    return 'Fokusmu bertahan sepanjang sesi ini.'
  }
  const minutes = Math.max(1, Math.floor(firstCollapseAtMs / 60_000))
  return `Fokusmu paling kuat di ${minutes} menit pertama.`
}

function metric(label: string, value: string): HTMLDivElement {
  return el('div', { class: 'metric' }, [el('span', { class: 'metric__label' }, [label]), el('span', { class: 'metric__value' }, [value])])
}

/** Only ever positive - there is no "you missed a milestone" text, because
 * there's no such thing here, only ones you've reached. */
function milestoneText(milestone: Milestone): string {
  return milestone.kind === 'streak'
    ? strings.sessionCard.milestoneStreak(milestone.value)
    : strings.sessionCard.milestoneSessionCount(milestone.value)
}

/**
 * The milestone moment: a soft amber halo behind Hachiko (reusing the
 * --glow-amber token base.css already defines for exactly this kind of
 * warmth) and a one-shot confetti burst - eight fixed pieces, no
 * randomization or animation loop, colors drawn only from the existing
 * palette. Both animations play once on mount and stop; nothing here
 * loops. Shown only here, after the session ends - never during one.
 */
function celebrationBlock(milestone: Milestone): HTMLDivElement {
  const confetti = el(
    'div',
    { class: 'celebration__confetti', 'aria-hidden': 'true' },
    Array.from({ length: 8 }, (_, i) => el('span', { class: `confetti-piece confetti-piece--${i + 1}` })),
  )
  const mascotWrap = el('div', { class: 'celebration__mascot-wrap' }, [
    el('div', { class: 'celebration__glow', 'aria-hidden': 'true' }),
    confetti,
    mascotPeek('celebrating'),
  ])
  return el('div', { class: 'celebration' }, [mascotWrap, el('p', { class: 'milestone-badge' }, [milestoneText(milestone)])])
}

export function renderSessionCard(
  root: HTMLElement,
  record: SessionRecord,
  telemetryJsonl: string,
  milestone: Milestone | null,
): Promise<'repeat' | 'done'> {
  return new Promise((resolve) => {
    const s = strings.sessionCard
    const { root: screenEl, content } = screen()
    const metrics = computeMetrics(record)

    const totalMinutes = Math.round((metrics.focusMs + metrics.sittingMs + metrics.uncertainMs) / 60_000)
    const focusLine = `${formatMinutes(metrics.focusMs)} dari ${totalMinutes}`

    const metricsGrid = el('div', { class: 'metrics' }, [
      metric(s.focusMinutesLabel, focusLine),
      metric(s.sittingMinutesLabel, `${formatMinutes(metrics.sittingMs)} menit`),
      metric(s.recoveryLabel, metrics.medianRecoveryMs === null ? s.recoveryUnknown : formatMinSec(metrics.medianRecoveryMs)),
      metric(
        s.uncertainLabel,
        `${formatMinutes(metrics.uncertainMs)} menit`,
      ),
    ])

    const cardChildren: (Node | string)[] = [metricsGrid, el('p', { class: 'observation' }, [observation(metrics.firstCollapseAtMs)])]
    if (metrics.exceedsUncertainThreshold) {
      cardChildren.push(el('p', { class: 'threshold-note' }, [s.uncertainThresholdNote]))
    }

    let settled = false
    let remainingMs = AUTO_CLOSE_MS
    let timer: number | null = null

    const autoNote = el('p', { class: 'note' }, [s.autoCloseNote(Math.ceil(remainingMs / 1000))])

    function stopTimer(): void {
      if (timer !== null) {
        window.clearInterval(timer)
        timer = null
      }
    }

    function startTimer(): void {
      stopTimer()
      timer = window.setInterval(() => {
        remainingMs -= 1000
        if (remainingMs <= 0) {
          finish('done')
          return
        }
        autoNote.textContent = s.autoCloseNote(Math.ceil(remainingMs / 1000))
      }, 1000)
    }

    function finish(decision: 'repeat' | 'done'): void {
      if (settled) return
      settled = true
      stopTimer()
      root.replaceChildren()
      resolve(decision)
    }

    const downloadBtn = button(s.downloadLabel, () => {
      remainingMs = AUTO_CLOSE_MS
      downloadJsonl(`hachiko-${record.id}.jsonl`, telemetryJsonl)
    }, { variant: 'secondary' })

    const doneBtn = button(s.doneLabel, () => finish('done'))

    const repeatBtn = button(s.repeatLabel, showConfirm, { variant: 'secondary' })

    const reportActions = actions(downloadBtn, repeatBtn, doneBtn)

    // Inline confirmation (no modal system) - the same card + actions
    // pattern as the in-session nudges. Swapped in place of the report
    // actions while open; "Batal" restores them and resumes auto-close.
    const confirmCard = card(
      el('h2', { class: 'card__title' }, [s.repeatConfirmTitle]),
      actions(
        button(s.repeatConfirmCancel, hideConfirm, { variant: 'secondary' }),
        button(s.repeatConfirmStart, () => finish('repeat')),
      ),
    )
    confirmCard.style.display = 'none'

    function showConfirm(): void {
      stopTimer()
      reportActions.style.display = 'none'
      autoNote.style.display = 'none'
      confirmCard.style.display = 'flex'
    }

    function hideConfirm(): void {
      remainingMs = AUTO_CLOSE_MS
      autoNote.textContent = s.autoCloseNote(Math.ceil(remainingMs / 1000))
      confirmCard.style.display = 'none'
      reportActions.style.display = 'flex'
      autoNote.style.display = ''
      startTimer()
    }

    const celebration: (Node | string)[] = milestone ? [celebrationBlock(milestone)] : []

    content.append(
      title(s.title),
      ...celebration,
      card(...cardChildren),
      body(s.downloadNote),
      reportActions,
      confirmCard,
      autoNote,
    )

    root.replaceChildren(screenEl)

    startTimer()
  })
}
