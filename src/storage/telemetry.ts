import type { Frame } from '../engine/types'

const KEY = 'hachiko.telemetry.v1'
// One recording now spans a whole multi-cycle sitting (several Work
// cycles joined together), so its size scales with however many cycles
// the student did - not a fixed ~25-minute cycle anymore. Keeping only
// the single most recent one is what actually stays safely under quota.
const MAX_RECORDINGS = 1

export interface TelemetryRow {
  t: number
  faceFound: boolean
  yaw: number | null
  pitch: number | null
  eyeBlink: number | null
  objects: string[]
}

/**
 * One JSONL row per frame during a session - numbers and COCO labels
 * only, never image data (CLAUDE.md constraint 3). Buffered in memory
 * during the session, written to localStorage once it ends.
 */
export class TelemetryRecorder {
  private rows: TelemetryRow[] = []

  record(frame: Frame): void {
    this.rows.push({
      t: frame.t,
      faceFound: frame.faceFound,
      yaw: frame.yaw,
      pitch: frame.pitch,
      eyeBlink: frame.eyeBlink,
      objects: frame.objects,
    })
  }

  toJsonl(): string {
    return this.rows.map((row) => JSON.stringify(row)).join('\n')
  }

  get rowCount(): number {
    return this.rows.length
  }

  reset(): void {
    this.rows = []
  }
}

interface StoredRecording {
  sessionId: string
  savedAt: number
  jsonl: string
}

/** Retains only the most recent MAX_RECORDINGS - only the export button ever leaves the browser. */
export function persistRecording(sessionId: string, jsonl: string): void {
  const existing = listRecordings()
  const next = [...existing, { sessionId, savedAt: Date.now(), jsonl }].slice(-MAX_RECORDINGS)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Quota exceeded - drop the oldest and try once more before giving up
    // silently. The export button (downloadJsonl) is the path that
    // actually matters for research data; this is a local convenience.
    try {
      localStorage.setItem(KEY, JSON.stringify(next.slice(1)))
    } catch {
      // Give up quietly; nothing here is safety-critical.
    }
  }
}

function listRecordings(): StoredRecording[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    return JSON.parse(raw) as StoredRecording[]
  } catch {
    return []
  }
}

/**
 * Student-initiated local file download. No automatic upload, no
 * `fetch`, ever (CLAUDE.md constraint 2) - this is demonstrated live on
 * stage with DevTools' Network tab open.
 */
export function downloadJsonl(filename: string, jsonl: string): void {
  const blob = new Blob([jsonl], { type: 'application/x-ndjson' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
