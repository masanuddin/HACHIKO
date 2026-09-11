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
  uncertainMs: number
  medianRecoveryMs: number | null
  firstCollapseAtMs: number | null
  uncertainPercent: number
  exceedsUncertainThreshold: boolean
}

/**
 * Turns a raw record into the four Session Card numbers (PRD §8).
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
 */
export function computeMetrics(record: SessionRecord): SessionMetrics {
  let focusMs = record.durationsMs.FOKUS
  let sittingMs = record.durationsMs.TERALIH + record.durationsMs.MENGANTUK
  let uncertainMs = record.uncertainMs

  const answer = record.clarification?.answer
  if (answer === 'book') {
    focusMs += uncertainMs
    uncertainMs = 0
  } else if (answer === 'phone' || answer === 'mixed') {
    sittingMs += uncertainMs
    uncertainMs = 0
  }

  const totalActiveMs = focusMs + sittingMs + uncertainMs
  const uncertainPercent = totalActiveMs > 0 ? uncertainMs / totalActiveMs : 0

  return {
    focusMs,
    sittingMs,
    uncertainMs,
    medianRecoveryMs: median(record.recoveryTimesMs),
    firstCollapseAtMs: record.firstCollapseAtMs,
    uncertainPercent,
    exceedsUncertainThreshold: uncertainPercent > UNCERTAIN_THRESHOLD,
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number)
}

export function emptyDurations(): Record<FocusState, number> {
  return { FOKUS: 0, TERALIH: 0, TIDAK_HADIR: 0, UNCERTAIN: 0, MENGANTUK: 0 }
}
