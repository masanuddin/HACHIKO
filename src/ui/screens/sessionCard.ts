import { strings, formatDuration, formatFocusLine, sessionObservation } from '../strings'
import { actions, body, button, card, doodleMark, el, screen, titleWithDoodle } from '../components'
import { computeMetrics, deleteAllSessions, deleteSession, listSessions, type SessionMetrics, type SessionRecord } from '../../storage/sessions'
import { buildSessionReportPdf, downloadPdf, pdfFilename } from '../pdf'
import { mascotPeek } from '../hachiko'
import type { Milestone } from '../../storage/companion'

function metric(label: string, value: string): HTMLDivElement {
  return el('div', { class: 'metric' }, [el('span', { class: 'metric__label' }, [label]), el('span', { class: 'metric__value' }, [value])])
}

/** The Session Card numbers (PRD §8), used by the read-only history
 * cards below the current session (the current session gets the bento
 * layout instead - see `bentoMetrics` below, which reads the same
 * `SessionMetrics` shape). `dari` total is the session's actual active
 * time (focus + sitting + uncertain) - no new timing here. */
function metricGrid(m: SessionMetrics): HTMLDivElement {
  const s = strings.sessionCard
  return el('div', { class: 'metrics' }, [
    metric(s.focusMinutesLabel, formatFocusLine(m.focusMs, m.sittingMs)),
    metric(s.sittingMinutesLabel, formatDuration(m.sittingMs)),
    metric(s.awayLabel, formatDuration(m.awayMs)),
    metric(s.uncertainLabel, formatDuration(m.uncertainMs)),
  ])
}

function bentoTile(
  modifier: string,
  tint: 'sand' | 'amber-tint' | 'sage-tint' | null,
  children: (Node | string)[],
): HTMLDivElement {
  const classes = ['bento-tile', `bento-tile--${modifier}`]
  if (tint) classes.push(`bento-tile--${tint}`)
  return el('div', { class: classes.join(' ') }, children)
}

function tileMetric(label: string, value: string, big = false): HTMLElement[] {
  return [
    el('span', { class: 'metric__label' }, [label]),
    el('span', { class: big ? 'metric__value metric__value--big' : 'metric__value' }, [value]),
  ]
}

/**
 * The current session's numbers as a bento grid (mascot tile,
 * a bigger Fokus tile since it's the headline number, the remaining
 * three metrics, and a wide observation tile) instead of the flat 2x2
 * grid `metricGrid` still renders for history. Same six pieces of
 * content as before - no metric added or dropped, just recomposed.
 */
function bentoMetrics(m: SessionMetrics, observationText: string): HTMLDivElement {
  const s = strings.sessionCard
  return el('div', { class: 'bento' }, [
    bentoTile('mascot', 'sand', [mascotPeek()]),
    bentoTile('focus', 'amber-tint', tileMetric(s.focusMinutesLabel, formatFocusLine(m.focusMs, m.sittingMs), true)),
    bentoTile('duduk', null, tileMetric(s.sittingMinutesLabel, formatDuration(m.sittingMs))),
    bentoTile('away', 'sage-tint', tileMetric(s.awayLabel, formatDuration(m.awayMs))),
    bentoTile('uncertain', null, tileMetric(s.uncertainLabel, formatDuration(m.uncertainMs))),
    bentoTile('observation', 'sand', [
      el('p', { class: 'observation' }, [observationText]),
      doodleMark('paw', { size: '36px' }),
    ]),
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
 * One read-only history card with an inline-confirmed delete control.
 * The delete button swaps in place to a "Hapus sesi ini?" confirm; the
 * current session (excluded from history) can never be deleted here.
 */
function historyCard(record: SessionRecord, _index: number, onDelete: (id: string) => void): HTMLDivElement {
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
  const cards = previous.map((r, i) => historyCard(r, i, onDelete))

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
    const bento = bentoMetrics(metrics, sessionObservation(metrics.firstCollapseAtMs))
    const thresholdNote = metrics.exceedsUncertainThreshold
      ? el('p', { class: 'threshold-note' }, [s.uncertainThresholdNote])
      : null

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
      titleWithDoodle(s.title, 'squiggle'),
      ...celebration,
      bento,
      ...(thresholdNote ? [thresholdNote] : []),
      historyWrap,
      body(s.downloadNote),
      reportActions,
      errorNote,
    )

    root.replaceChildren(screenEl)
  })
}
