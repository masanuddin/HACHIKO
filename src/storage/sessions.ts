import type { FocusState, Media } from '../engine/types'

const KEY = 'hachiko.sessions.v1'

export interface DistractionSpan {
  /** ms relative to session start */
  start: number
  end: number
}

export type ClarificationAnswer = 'book' | 'phone' | 'mixed'

export interface SessionRecord {
  id: string
  startedAt: number
  declaredMedia: Media[]
  /** User-authored study topic (e.g. "Matematika - Integral"). Metadata only,
   *  never an input to CV/FocusEngine. Optional so pre-feature records stay valid. */
  studyTopic?: string
  durationsMs: Record<FocusState, number>
  distractionEvents: DistractionSpan[]
  recoveryTimesMs: number[]
  uncertainMs: number
  firstCollapseAtMs: number | null
  /** null when there was nothing ambiguous to ask about at the break. */
  clarification: { answer: ClarificationAnswer | null } | null
}

export function saveSession(record: SessionRecord): void {
  const all = listSessions()
  all.push(record)
  localStorage.setItem(KEY, JSON.stringify(all))
}

/** Removes a single session record by id, leaving every other session intact. */
export function deleteSession(id: string): void {
  const all = listSessions()
  localStorage.setItem(KEY, JSON.stringify(all.filter((s) => s.id !== id)))
}

/**
 * Clears the entire user-facing session history. No exception: the
 * currently-shown session is already persisted before the Session Card
 * renders, so "Hapus semua sesi" removes it from storage too - the card
 * keeps showing its in-memory copy until the flow ends, and nothing here
 * re-saves it afterward.
 */
export function deleteAllSessions(): void {
  localStorage.removeItem(KEY)
}

export function listSessions(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    return JSON.parse(raw) as SessionRecord[]
  } catch {
    return []
  }
}

/** PRD §8's pre-registered failure threshold: above this, the context layer has failed. */
export const UNCERTAIN_THRESHOLD = 0.2

export interface SessionMetrics {
  focusMs: number
  sittingMs: number
  awayMs: number
  uncertainMs: number
  notFocusedMs: number
  firstCollapseAtMs: number | null
  uncertainPercent: number
  notFocusedPercent: number
  exceedsUncertainThreshold: boolean
}

/**
 * Turns a raw record into the Session Card numbers (PRD §8).
 *
 * A clarification answer resolves the session's *entire* uncertain total
 * to one bucket - "Baca buku" folds it into focus, "Pegang HP" /
 * "Campuran" folds it into sitting - because the break card asks one
 * question about the whole ambiguous group, not per-event. Skipping the
 * card, or the student not answering, leaves it uncertain. Nothing here
 * ever touches the FocusState values the engine already reported live;
 * this only reclassifies how *uncertain time* is summarised afterward.
 *
 * MENGANTUK isn't in PRD §7's timer table. Treated as present-but-not-
 * focused, same bucket as TERALIH, since the timer keeps running (only
 * TIDAK_HADIR pauses it) and drowsy-at-the-desk isn't "focus."
 *
 * Presence is the two-sided line the card reports: `sittingMs` is every
 * moment the student was in frame (FOKUS + TERALIH + MENGANTUK +
 * UNCERTAIN), and `awayMs` is every moment they were not (TIDAK_HADIR).
 * Clarification never moves time across that line - only focus-vs-
 * distraction on the "hadir" side is reclassified.
 */
export function computeMetrics(record: SessionRecord): SessionMetrics {
  const d = record.durationsMs
  let focusMs = d.FOKUS
  let uncertainMs = record.uncertainMs

  const answer = record.clarification?.answer
  if (answer === 'book') {
    focusMs += uncertainMs
    uncertainMs = 0
  } else if (answer === 'phone' || answer === 'mixed') {
    uncertainMs = 0
  }

  const sittingMs = d.FOKUS + d.TERALIH + d.MENGANTUK + record.uncertainMs
  const awayMs = d.TIDAK_HADIR

  const totalActiveMs = sittingMs
  const uncertainPercent = totalActiveMs > 0 ? uncertainMs / totalActiveMs : 0

  // "Waktu tidak fokus" = every present moment that wasn't focus: TERALIH +
  // MENGANTUK + whatever UNCERTAIN the clarification did not fold into focus.
  const notFocusedMs = sittingMs - focusMs
  const notFocusedPercent = totalActiveMs > 0 ? notFocusedMs / totalActiveMs : 0

  return {
    focusMs,
    sittingMs,
    awayMs,
    uncertainMs,
    notFocusedMs,
    firstCollapseAtMs: record.firstCollapseAtMs,
    uncertainPercent,
    notFocusedPercent,
    exceedsUncertainThreshold: uncertainPercent > UNCERTAIN_THRESHOLD,
  }
}

/**
 * Which studyTopic has accumulated the most total focus time across
 * every given session, not just the most recent one - "kamu paling
 * fokus pas belajar X" is a claim about all of a student's history, so
 * it has to be computed from all of it rather than echoed from
 * whichever session happens to be on screen. Sessions with no declared
 * topic don't participate; returns null when nothing has one.
 */
export function bestFocusTopic(records: SessionRecord[]): string | null {
  const totalFocusMsByTopic = new Map<string, number>()
  for (const record of records) {
    const topic = record.studyTopic?.trim()
    if (!topic) continue
    const focusMs = computeMetrics(record).focusMs
    totalFocusMsByTopic.set(topic, (totalFocusMsByTopic.get(topic) ?? 0) + focusMs)
  }

  let best: string | null = null
  let bestFocusMs = -1
  for (const [topic, focusMs] of totalFocusMsByTopic) {
    if (focusMs > bestFocusMs) {
      best = topic
      bestFocusMs = focusMs
    }
  }
  return best
}

export function emptyDurations(): Record<FocusState, number> {
  return { FOKUS: 0, TERALIH: 0, TIDAK_HADIR: 0, UNCERTAIN: 0, MENGANTUK: 0 }
}

/**
 * Combines every cycle of a multi-cycle Pomodoro session into the one
 * record that actually gets saved and shown - durations summed, spans
 * concatenated onto one continuous timeline (each cycle's own spans are
 * offset by every prior cycle's total elapsed time, since each cycle's
 * timestamps start over at zero), uncertain time summed. `clarification`
 * is always null here - the caller sets it once, after this merge, from
 * a single end-of-loop Clarify screen covering the combined uncertain
 * time. `records` is assumed non-empty - the caller's loop always runs
 * at least one cycle before ever merging.
 */
export function mergeSessionRecords(id: string, records: SessionRecord[]): SessionRecord {
  const durationsMs = emptyDurations()
  const distractionEvents: DistractionSpan[] = []
  const recoveryTimesMs: number[] = []
  let uncertainMs = 0
  let firstCollapseAtMs: number | null = null
  let elapsedOffset = 0

  for (const record of records) {
    for (const key of Object.keys(durationsMs) as FocusState[]) {
      durationsMs[key] += record.durationsMs[key]
    }
    for (const span of record.distractionEvents) {
      distractionEvents.push({ start: span.start + elapsedOffset, end: span.end + elapsedOffset })
    }
    recoveryTimesMs.push(...record.recoveryTimesMs)
    uncertainMs += record.uncertainMs
    if (record.firstCollapseAtMs !== null && firstCollapseAtMs === null) {
      firstCollapseAtMs = record.firstCollapseAtMs + elapsedOffset
    }

    const cycleElapsedMs = Object.values(record.durationsMs).reduce((sum, ms) => sum + ms, 0)
    elapsedOffset += cycleElapsedMs
  }

  const first = records[0] as SessionRecord

  return {
    id,
    startedAt: first.startedAt,
    declaredMedia: first.declaredMedia,
    ...(first.studyTopic ? { studyTopic: first.studyTopic } : {}),
    durationsMs,
    distractionEvents,
    recoveryTimesMs,
    uncertainMs,
    firstCollapseAtMs,
    clarification: null,
  }
}
