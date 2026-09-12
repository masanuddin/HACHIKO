import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeMetrics,
  deleteAllSessions,
  deleteSession,
  emptyDurations,
  listSessions,
  saveSession,
  type SessionRecord,
} from './sessions'

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's-test',
    startedAt: 0,
    declaredMedia: ['laptop'],
    durationsMs: emptyDurations(),
    distractionEvents: [],
    recoveryTimesMs: [],
    uncertainMs: 0,
    firstCollapseAtMs: null,
    clarification: null,
    ...overrides,
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, String(v))
    },
    removeItem: (k) => {
      map.delete(k)
    },
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

describe('computeMetrics', () => {
  it('reports away as the total TIDAK_HADIR time', () => {
    const m = computeMetrics(record({ durationsMs: { ...emptyDurations(), TIDAK_HADIR: 20_000 } }))
    expect(m.awayMs).toBe(20_000)
  })

  it('counts FOKUS, TERALIH, MENGANTUK and UNCERTAIN as sitting (present)', () => {
    const m = computeMetrics(
      record({
        durationsMs: { ...emptyDurations(), FOKUS: 60_000, TERALIH: 30_000, MENGANTUK: 10_000, TIDAK_HADIR: 20_000 },
        uncertainMs: 5_000,
      }),
    )
    expect(m.sittingMs).toBe(60_000 + 30_000 + 10_000 + 5_000)
    expect(m.awayMs).toBe(20_000)
    expect(m.focusMs).toBe(60_000)
    expect(m.uncertainMs).toBe(5_000)
  })

  it('never treats TERALIH as away', () => {
    const m = computeMetrics(record({ durationsMs: { ...emptyDurations(), TERALIH: 45_000, TIDAK_HADIR: 0 } }))
    expect(m.awayMs).toBe(0)
    expect(m.sittingMs).toBe(45_000)
  })

  it('"Baca buku" clarification folds uncertain into focus but leaves sitting present', () => {
    const m = computeMetrics(
      record({
        durationsMs: { ...emptyDurations(), FOKUS: 60_000 },
        uncertainMs: 5_000,
        clarification: { answer: 'book' },
      }),
    )
    expect(m.focusMs).toBe(65_000)
    expect(m.uncertainMs).toBe(0)
    expect(m.sittingMs).toBe(65_000)
  })

  it('"Pegang HP" clarification zeroes uncertain but leaves sitting present', () => {
    const m = computeMetrics(
      record({
        durationsMs: { ...emptyDurations(), FOKUS: 60_000 },
        uncertainMs: 5_000,
        clarification: { answer: 'phone' },
      }),
    )
    expect(m.focusMs).toBe(60_000)
    expect(m.uncertainMs).toBe(0)
    expect(m.sittingMs).toBe(65_000)
  })
})

describe('session storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })

  it('deleteSession removes one session and preserves the others', () => {
    saveSession(record({ id: 'a' }))
    saveSession(record({ id: 'b' }))
    saveSession(record({ id: 'c' }))

    deleteSession('b')

    expect(listSessions().map((s) => s.id)).toEqual(['a', 'c'])
  })

  it('deleteAllSessions leaves zero sessions (key removed)', () => {
    saveSession(record({ id: 'a' }))
    saveSession(record({ id: 'b' }))
    saveSession(record({ id: 'c' }))

    deleteAllSessions()

    expect(listSessions()).toEqual([])
    expect(localStorage.getItem('hachiko.sessions.v1')).toBeNull()
  })

  it('deleteAllSessions does not recreate records', () => {
    saveSession(record({ id: 'current' }))

    deleteAllSessions()
    expect(listSessions()).toEqual([])

    // A later deleteAllSessions on an already-empty history stays empty.
    deleteAllSessions()
    expect(listSessions()).toEqual([])
  })
})
