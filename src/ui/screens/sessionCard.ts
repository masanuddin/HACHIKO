import { strings, formatDuration, sessionObservation, sessionTitle } from '../strings'
import { actions, body, button, card, confirmOverlay, doodleMark, el, screen, titleWithDoodle } from '../components'
import { bestFocusTopic, computeMetrics, deleteAllSessions, deleteSession, listSessions, type SessionMetrics, type SessionRecord } from '../../storage/sessions'
import { loadProfile } from '../../storage/profile'
import { buildSessionReportPdf, downloadPdf, pdfFilename } from '../pdf'
import { mascotPeek } from '../hachiko'
import type { Milestone } from '../../storage/companion'

function metric(label: string, value: string): HTMLDivElement {
  return el('div', { class: 'metric' }, [el('span', { class: 'metric__label' }, [label]), el('span', { class: 'metric__value' }, [value])])
}

/** The Session Card numbers (PRD §8), used by the read-only history
 * cards below the current session (the current session gets the bento
 * layout instead - see `bentoMetrics` below, which reads the same
 * `SessionMetrics` shape). Each value stands alone - no "X dari Y"
 * comparison; that composition read as redundant noise on a card this
 * compact. */
function metricGrid(m: SessionMetrics): HTMLDivElement {
  const s = strings.sessionCard
  return el('div', { class: 'metrics' }, [
    metric(s.focusMinutesLabel, formatDuration(m.focusMs)),
    metric(s.sittingMinutesLabel, formatDuration(m.sittingMs)),
    metric(s.awayLabel, formatDuration(m.awayMs)),
    metric(s.notFocusedLabel, formatDuration(m.notFocusedMs)),
  ])
}

function bentoTile(
  modifier: string,
  tint: 'sand' | 'amber-tint' | 'sage-tint' | 'blue-tint' | 'peach-tint' | null,
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

/** Decorative seal overlapping the bento grid's top-right corner, same
 *  placement language as the PDF report's stamp (pdf.ts's STAMP_X/Y) -
 *  the two surfaces read as the same "report", stamped the same way.
 *  `aria-hidden` since it carries no information beyond what the grid's
 *  own labeled tiles already say. */
function reportStamp(): HTMLImageElement {
  return el('img', {
    class: 'session-card-stamp',
    src: '/stamp.png',
    alt: '',
    'aria-hidden': 'true',
  }) as HTMLImageElement
}

/**
 * The current session's numbers as a bento grid, achievement-style: the
 * Fokus number is the headline, alone on its own full-width row at the
 * same size as the live session timer (--text-timer) - not compared
 * against anything, just "how long you made it". The remaining three
 * metrics, the mascot, and the observation sit below it as supporting
 * detail. Same six pieces of content as before - no metric added or
 * dropped, just recomposed.
 */
function bentoMetrics(m: SessionMetrics, observationText: string): HTMLDivElement {
  const s = strings.sessionCard
  return el('div', { class: 'bento' }, [
    bentoTile('hero', 'amber-tint', tileMetric(s.focusMinutesLabel, formatDuration(m.focusMs), true)),
    bentoTile('mascot', 'peach-tint', [mascotPeek()]),
    bentoTile('duduk', 'blue-tint', tileMetric(s.sittingMinutesLabel, formatDuration(m.sittingMs))),
    bentoTile('away', 'sage-tint', tileMetric(s.awayLabel, formatDuration(m.awayMs))),
    bentoTile('uncertain', null, tileMetric(s.uncertainLabel, formatDuration(m.uncertainMs))),
    bentoTile('observation', 'sand', [
      el('p', { class: 'observation' }, [observationText]),
      doodleMark('paw', { size: '36px' }),
    ]),
    reportStamp(),
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

/** The study-topic insight sentence: whichever topic has accumulated the
 *  most total focus time across every saved session (see bestFocusTopic),
 *  not just this one - shown only when at least one session anywhere has
 *  a declared topic. */
function topicInsight(): (Node | string)[] {
  const best = bestFocusTopic(listSessions())
  return best ? [el('p', { class: 'observation' }, [strings.sessionCard.topicInsight(best)])] : []
}

/**
 * One read-only history card with a delete control that opens a confirm
 * overlay. The current session (excluded from history) can never be
 * deleted here.
 */
function historyCard(
  record: SessionRecord,
  _index: number,
  onDelete: (id: string) => void,
  screenEl: HTMLElement,
): HTMLDivElement {
  const s = strings.sessionCard

  function showConfirm(): void {
    const overlay = confirmOverlay(
      screenEl,
      [
        el('h2', { class: 'card__title' }, [s.deleteConfirmTitle]),
        actions(
          button(s.deleteConfirmCancel, () => overlay.close(), { variant: 'secondary' }),
          button(s.deleteConfirmYes, () => {
            overlay.close()
            onDelete(record.id)
          }),
        ),
      ],
      () => overlay.close(),
    )
  }

  const controls = el('div', { class: 'history-card__actions' }, [
    button(s.deleteSessionLabel, showConfirm, { variant: 'secondary' }),
  ])

  return card(
    el('p', { class: 'history-card__time' }, [sessionTimeLabel(record.startedAt)]),
    ...topicLine(record),
    metricGrid(computeMetrics(record)),
    controls,
  )
}

/**
 * A compact, clickable summary of past sessions - shown as a "dashboard"
 * beside the current-session bento grid (see .session-card-grid).
 * Clicking it opens the full list in a wide confirmOverlay rather than
 * navigating anywhere - this app has no router, and a large overlay
 * reuses the same dismissible pattern every other confirm already does.
 */
function historyDashboard(count: number, onExpand: () => void): HTMLButtonElement {
  const s = strings.sessionCard
  const dashboard = el('button', { class: 'card session-history-dashboard', type: 'button' }, [
    el('h2', { class: 'card__title' }, [s.historyTitle]),
    el('p', { class: 'session-history-dashboard__count' }, [s.historyCount(count)]),
    el('span', { class: 'session-history-dashboard__cta' }, [s.historyViewAll]),
  ])
  dashboard.addEventListener('click', onExpand)
  return dashboard
}

/**
 * The expanded history list's content, shown inside a wide confirmOverlay.
 * `render()` re-draws just the list/delete-all controls in place (the
 * overlay itself stays open) so deleting an entry doesn't kick the
 * student back out to the main screen - and calls `onEmpty` if that
 * delete just emptied the list entirely, since there's nothing left to
 * browse at that point. `onChange` runs after every delete so the
 * caller can refresh the compact dashboard's count behind the overlay.
 */
function historyOverlayContent(
  currentId: string,
  onDelete: (id: string) => void,
  onDeleteAll: () => void,
  onChange: () => void,
  onEmpty: () => void,
  screenEl: HTMLElement,
): (Node | string)[] {
  const s = strings.sessionCard
  const listEl = el('div', { class: 'session-history__list' })
  const allControls = el('div', { class: 'session-history__delete-all' })

  function render(): void {
    const previous = listSessions()
      .filter((r) => r.id !== currentId)
      .sort((a, b) => b.startedAt - a.startedAt)
    if (previous.length === 0) {
      onEmpty()
      return
    }
    listEl.replaceChildren(
      ...previous.map((r, i) =>
        historyCard(
          r,
          i,
          (id) => {
            onDelete(id)
            onChange()
            render()
          },
          screenEl,
        ),
      ),
    )
    allControls.replaceChildren(button(s.deleteAllSessionsLabel, showDeleteAllConfirm, { variant: 'secondary' }))
  }

  function showDeleteAllConfirm(): void {
    const overlay = confirmOverlay(
      screenEl,
      [
        el('h2', { class: 'card__title' }, [s.deleteAllConfirmTitle]),
        actions(
          button(s.deleteConfirmCancel, () => overlay.close(), { variant: 'secondary' }),
          button(s.deleteAllConfirmYes, () => {
            overlay.close()
            onDeleteAll()
            onChange()
            render()
          }),
        ),
      ],
      () => overlay.close(),
    )
  }

  render()

  return [el('h2', { class: 'card__title' }, [s.historyTitle]), listEl, allControls]
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
    // Same reasoning as Ready/Calibration's own fix: a 2-column layout
    // (history dashboard left, bento right) needs more room than
    // .screen__content's 720px default.
    content.classList.add('screen__content--wide')
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
        const bytes = buildSessionReportPdf(record, loadProfile()?.name)
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

    // The history dashboard sits beside bento in this grid; when there's
    // no history yet, dashboardWrap is removed from grid flow entirely
    // (display:none) rather than left empty, so --solo's single column
    // never leaves a phantom gap above bento (see the CSS comment).
    const dashboardWrap = el('div')
    const grid = el('div', { class: 'session-card-grid' }, [dashboardWrap, bento])

    function refreshDashboard(): void {
      const previousCount = listSessions().filter((r) => r.id !== record.id).length
      if (previousCount === 0) {
        dashboardWrap.replaceChildren()
        dashboardWrap.style.display = 'none'
        grid.classList.add('session-card-grid--solo')
        return
      }
      dashboardWrap.style.display = ''
      grid.classList.remove('session-card-grid--solo')
      dashboardWrap.replaceChildren(historyDashboard(previousCount, openHistoryOverlay))
    }

    function openHistoryOverlay(): void {
      const overlay = confirmOverlay(
        screenEl,
        historyOverlayContent(
          record.id,
          deleteSession,
          deleteAllSessions,
          refreshDashboard,
          () => overlay.close(),
          screenEl,
        ),
        () => overlay.close(),
        { wide: true },
      )
    }

    refreshDashboard()

    content.append(
      titleWithDoodle(sessionTitle(loadProfile()?.name), 'squiggle'),
      ...celebration,
      ...topicLine(record),
      grid,
      ...topicInsight(),
      ...(thresholdNote ? [thresholdNote] : []),
      body(s.downloadNote),
      reportActions,
      errorNote,
    )

    root.replaceChildren(screenEl)
  })
}
