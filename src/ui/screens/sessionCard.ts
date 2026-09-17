import { strings, formatDuration, formatFocusLine, sessionObservation, sessionTitle } from '../strings'
import { actions, body, button, card, el, screen, title } from '../components'
import { computeMetrics, deleteAllSessions, deleteSession, listSessions, type SessionMetrics, type SessionRecord } from '../../storage/sessions'
import { loadProfile } from '../../storage/profile'
import { buildSessionReportPdf, downloadPdf, pdfFilename } from '../pdf'
import { mascotPeek } from '../hachiko'
import type { Milestone } from '../../storage/companion'

function metric(label: string, value: string): HTMLDivElement {
  return el('div', { class: 'metric' }, [el('span', { class: 'metric__label' }, [label]), el('span', { class: 'metric__value' }, [value])])
}

/** The Session Card numbers (PRD §8), shared by the current card and
 * the read-only history cards below it. `dari` total is the session's
 * actual active time (focus + sitting + uncertain) - no new timing here. */
function metricGrid(m: SessionMetrics): HTMLDivElement {
  const s = strings.sessionCard
  return el('div', { class: 'metrics' }, [
    metric(s.focusMinutesLabel, formatFocusLine(m.focusMs, m.sittingMs)),
    metric(s.sittingMinutesLabel, formatDuration(m.sittingMs)),
    metric(s.awayLabel, formatDuration(m.awayMs)),
    metric(s.notFocusedLabel, formatDuration(m.notFocusedMs)),
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

/** The user-authored study topic, or nothing at all when absent (so old
 *  sessions without the field never render an empty/undefined row). */
function topicLine(record: SessionRecord): (Node | string)[] {
  return record.studyTopic ? [el('p', { class: 'session-topic' }, [record.studyTopic])] : []
}

/** The study-topic insight sentence, or nothing when the record has no
 *  topic (old sessions stay clean rather than showing a broken sentence). */
function topicInsight(record: SessionRecord): (Node | string)[] {
  return record.studyTopic
    ? [el('p', { class: 'observation' }, [strings.sessionCard.topicInsight(record.studyTopic)])]
    : []
}

/**
 * One read-only history card with an inline-confirmed delete control.
 * The delete button swaps in place to a "Hapus sesi ini?" confirm; the
 * current session (excluded from history) can never be deleted here.
 */
function historyCard(record: SessionRecord, onDelete: (id: string) => void): HTMLDivElement {
  const s = strings.sessionCard
  const controls = el('div', { class: 'history-card__actions' })

  function showDelete(): void {
    controls.replaceChildren(button(s.deleteSessionLabel, showConfirm, { variant: 'secondary' }))
  }

  function showConfirm(): void {
    controls.replaceChildren(
      el('span', { class: 'history-card__confirm' }, [s.deleteConfirmTitle]),
      button(s.deleteConfirmYes, () => onDelete(record.id), { variant: 'secondary' }),
      button(s.deleteConfirmCancel, showDelete, { variant: 'secondary' }),
    )
  }

  showDelete()

  return card(
    el('p', { class: 'history-card__time' }, [sessionTimeLabel(record.startedAt)]),
    ...topicLine(record),
    metricGrid(computeMetrics(record)),
    controls,
  )
}

/**
 * Previous completed sessions, newest first. Storage already keeps every
 * session (saveSession appends); this just stops the UI from dropping
 * them. Renders only when there is at least one prior session.
 */
function historySection(currentId: string, onDelete: (id: string) => void, onDeleteAll: () => void): HTMLElement | null {
  const previous = listSessions()
    .filter((r) => r.id !== currentId)
    .sort((a, b) => b.startedAt - a.startedAt)
  if (previous.length === 0) return null

  const s = strings.sessionCard
  const cards = previous.map((r) => historyCard(r, onDelete))

  const allControls = el('div', { class: 'session-history__delete-all' })

  function showDeleteAll(): void {
    allControls.replaceChildren(button(s.deleteAllSessionsLabel, showDeleteAllConfirm, { variant: 'secondary' }))
  }

  function showDeleteAllConfirm(): void {
    allControls.replaceChildren(
      el('span', { class: 'history-card__confirm' }, [s.deleteAllConfirmTitle]),
      button(s.deleteAllConfirmYes, onDeleteAll, { variant: 'secondary' }),
      button(s.deleteConfirmCancel, showDeleteAll, { variant: 'secondary' }),
    )
  }

  showDeleteAll()

  return el('div', { class: 'session-history' }, [
    el('h2', { class: 'session-history__title' }, [s.historyTitle]),
    el('div', { class: 'session-history__list' }, cards),
    allControls,
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
): Promise<void> {
  return new Promise((resolve) => {
    const s = strings.sessionCard
    const { root: screenEl, content } = screen()
    const metrics = computeMetrics(record)
    const metricsGrid = metricGrid(metrics)

    const cardChildren: (Node | string)[] = [...topicLine(record), metricsGrid, el('p', { class: 'observation' }, [sessionObservation(metrics.firstCollapseAtMs)]), ...topicInsight(record)]
    if (metrics.exceedsUncertainThreshold) {
      cardChildren.push(el('p', { class: 'threshold-note' }, [s.uncertainThresholdNote]))
    }

    let settled = false

    function finish(): void {
      if (settled) return
      settled = true
      root.replaceChildren()
      resolve()
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

    const doneBtn = button(s.doneLabel, finish)

    const reportActions = actions(downloadBtn, doneBtn)

    const celebration: (Node | string)[] = milestone ? [celebrationBlock(milestone)] : []
    const historyWrap = el('div')

    function renderHistory(): void {
      const history = historySection(
        record.id,
        (id) => {
          deleteSession(id)
          renderHistory()
        },
        () => {
          deleteAllSessions()
          renderHistory()
        },
      )
      historyWrap.replaceChildren(...(history ? [history] : []))
    }
    renderHistory()

    content.append(
      title(sessionTitle(loadProfile()?.name)),
      ...celebration,
      card(...cardChildren),
      historyWrap,
      body(s.downloadNote),
      reportActions,
      errorNote,
    )

    root.replaceChildren(screenEl)
  })
}
