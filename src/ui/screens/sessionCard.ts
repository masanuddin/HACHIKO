import { strings, formatDuration, formatFocusLine, formatRecovery, sessionObservation } from '../strings'
import { actions, body, button, card, el, screen, title } from '../components'
import { computeMetrics, listSessions, type SessionMetrics, type SessionRecord } from '../../storage/sessions'
import { buildSessionReportPdf, downloadPdf, pdfFilename } from '../pdf'
import { mascotPeek } from '../hachiko'
import type { Milestone } from '../../storage/companion'

function metric(label: string, value: string): HTMLDivElement {
  return el('div', { class: 'metric' }, [el('span', { class: 'metric__label' }, [label]), el('span', { class: 'metric__value' }, [value])])
}

/** The four Session Card numbers (PRD §8), shared by the current card and
 * the read-only history cards below it. `dari` total is the session's
 * actual active time (focus + sitting + uncertain) - no new timing here. */
function metricGrid(m: SessionMetrics): HTMLDivElement {
  const s = strings.sessionCard
  return el('div', { class: 'metrics' }, [
    metric(s.focusMinutesLabel, formatFocusLine(m.focusMs, m.sittingMs, m.uncertainMs)),
    metric(s.sittingMinutesLabel, formatDuration(m.sittingMs)),
    metric(s.recoveryLabel, formatRecovery(m.medianRecoveryMs)),
    metric(s.uncertainLabel, formatDuration(m.uncertainMs)),
  ])
}

function sessionTimeLabel(startedAt: number): string {
  return new Date(startedAt).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Previous completed sessions, newest first, read-only. Storage already
 * keeps every session (saveSession appends); this just stops the UI from
 * dropping them. Renders only when there is at least one prior session.
 */
function historySection(currentId: string): HTMLElement | null {
  const previous = listSessions()
    .filter((r) => r.id !== currentId)
    .sort((a, b) => b.startedAt - a.startedAt)
  if (previous.length === 0) return null

  const s = strings.sessionCard
  const cards = previous.map((r) =>
    card(el('p', { class: 'history-card__time' }, [sessionTimeLabel(r.startedAt)]), metricGrid(computeMetrics(r))),
  )

  return el('div', { class: 'session-history' }, [
    el('h2', { class: 'session-history__title' }, [s.historyTitle]),
    el('div', { class: 'session-history__list' }, cards),
  ])
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
  milestone: Milestone | null,
): Promise<'repeat' | 'done'> {
  return new Promise((resolve) => {
    const s = strings.sessionCard
    const { root: screenEl, content } = screen()
    const metrics = computeMetrics(record)
    const metricsGrid = metricGrid(metrics)

    const cardChildren: (Node | string)[] = [metricsGrid, el('p', { class: 'observation' }, [sessionObservation(metrics.firstCollapseAtMs)])]
    if (metrics.exceedsUncertainThreshold) {
      cardChildren.push(el('p', { class: 'threshold-note' }, [s.uncertainThresholdNote]))
    }

    let settled = false

    function finish(decision: 'repeat' | 'done'): void {
      if (settled) return
      settled = true
      root.replaceChildren()
      resolve(decision)
    }

    const errorNote = el('p', { class: 'note' }, [s.downloadError])
    errorNote.style.display = 'none'

    const downloadBtn = button(s.downloadLabel, () => {
      try {
        const bytes = buildSessionReportPdf(record)
        downloadPdf(pdfFilename(record.startedAt), bytes)
        errorNote.style.display = 'none'
      } catch (err) {
        console.error(err)
        errorNote.style.display = ''
      }
    }, { variant: 'secondary' })

    const doneBtn = button(s.doneLabel, () => finish('done'))

    const repeatBtn = button(s.repeatLabel, showConfirm, { variant: 'secondary' })

    const reportActions = actions(downloadBtn, repeatBtn, doneBtn)

    // Inline confirmation (no modal system) - the same card + actions
    // pattern as the in-session nudges. Swapped in place of the report
    // actions while open; "Batal" restores them.
    const confirmCard = card(
      el('h2', { class: 'card__title' }, [s.repeatConfirmTitle]),
      actions(
        button(s.repeatConfirmCancel, hideConfirm, { variant: 'secondary' }),
        button(s.repeatConfirmStart, () => finish('repeat')),
      ),
    )
    confirmCard.style.display = 'none'

    function showConfirm(): void {
      reportActions.style.display = 'none'
      confirmCard.style.display = 'flex'
    }

    function hideConfirm(): void {
      confirmCard.style.display = 'none'
      reportActions.style.display = 'flex'
    }

    const celebration: (Node | string)[] = milestone ? [celebrationBlock(milestone)] : []
    const history = historySection(record.id)

    content.append(
      title(s.title),
      ...celebration,
      card(...cardChildren),
      ...(history ? [history] : []),
      body(s.downloadNote),
      reportActions,
      errorNote,
      confirmCard,
    )

    root.replaceChildren(screenEl)
  })
}
