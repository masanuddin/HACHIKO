import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bestFocusTopic,
  computeMetrics,
  deleteAllSessions,
  deleteSession,
  emptyDurations,
  listSessions,
  mergeSessionRecords,
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
    expect(m.notFocusedMs).toBe(30_000 + 10_000 + 5_000)
    expect(m.notFocusedPercent).toBeCloseTo(45_000 / 105_000)
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
    expect(m.notFocusedMs).toBe(0)
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
    expect(m.notFocusedMs).toBe(5_000)
  })

  it('accumulates "Waktu tidak fokus" across merged multi-cycle records', () => {
    const cycle1 = record({ durationsMs: { ...emptyDurations(), FOKUS: 0, TERALIH: 600_000 } })
    const cycle2 = record({ durationsMs: { ...emptyDurations(), FOKUS: 0, TERALIH: 300_000 } })
    const merged = mergeSessionRecords('s-merged', [cycle1, cycle2])
    const m = computeMetrics(merged)
    expect(m.notFocusedMs).toBe(900_000)
  })
})

describe('bestFocusTopic', () => {
  it('picks the topic with the most total focus time across all sessions, not just the latest', () => {
    const math = record({ studyTopic: 'Matematika', durationsMs: { ...emptyDurations(), FOKUS: 10 * 60_000 } })
    const english = record({ studyTopic: 'Bahasa Inggris', durationsMs: { ...emptyDurations(), FOKUS: 60_000 } })
    // The latest session (english) has only 1 minute of focus - math has
    // 10x the accumulated focus time across sessions, so it should win
    // even though it isn't the most recent session.
    expect(bestFocusTopic([math, english])).toBe('Matematika')
  })

  it('sums focus time across multiple sessions on the same topic', () => {
    const a = record({ studyTopic: 'Fisika', durationsMs: { ...emptyDurations(), FOKUS: 5 * 60_000 } })
    const b = record({ studyTopic: 'Fisika', durationsMs: { ...emptyDurations(), FOKUS: 4 * 60_000 } })
    const c = record({ studyTopic: 'Kimia', durationsMs: { ...emptyDurations(), FOKUS: 8 * 60_000 } })
    // Fisika: 5+4=9 accumulated minutes beats Kimia's single 8-minute session.
    expect(bestFocusTopic([a, b, c])).toBe('Fisika')
  })

  it('ignores sessions with no declared topic', () => {
    const withTopic = record({ studyTopic: 'Matematika', durationsMs: { ...emptyDurations(), FOKUS: 60_000 } })
    const withoutTopic = record({ durationsMs: { ...emptyDurations(), FOKUS: 10 * 60_000 } })
    expect(bestFocusTopic([withTopic, withoutTopic])).toBe('Matematika')
  })

  it('returns null when no session has a topic', () => {
    expect(bestFocusTopic([record(), record()])).toBeNull()
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

  it('persists a non-empty studyTopic and reads it back', () => {
    saveSession(record({ id: 'a', studyTopic: 'IPA - Sistem Pernapasan' }))
    const saved = listSessions()[0]
    expect(saved?.studyTopic).toBe('IPA - Sistem Pernapasan')
  })

  it('reads a legacy record without studyTopic as undefined', () => {
    localStorage.setItem('hachiko.sessions.v1', JSON.stringify([{ id: 'old', startedAt: 0, declaredMedia: ['book'] }]))
    const old = listSessions()[0]
    expect(old?.studyTopic).toBeUndefined()
  })
})

describe('mergeSessionRecords', () => {
  it('single record -> equivalent data with the new id', () => {
    const only = record({
      startedAt: 5_000,
      declaredMedia: ['book'],
      durationsMs: { ...emptyDurations(), FOKUS: 1000 },
      uncertainMs: 200,
    })
    const merged = mergeSessionRecords('s-merged', [only])
    expect(merged.id).toBe('s-merged')
    expect(merged.startedAt).toBe(5_000)
    expect(merged.declaredMedia).toEqual(['book'])
    expect(merged.durationsMs.FOKUS).toBe(1000)
    expect(merged.uncertainMs).toBe(200)
    expect(merged.clarification).toBeNull()
  })

  it('two records -> durationsMs summed per key', () => {
    const a = record({ durationsMs: { ...emptyDurations(), FOKUS: 1000, TERALIH: 200 } })
    const b = record({ durationsMs: { ...emptyDurations(), FOKUS: 500, MENGANTUK: 100 } })
    const merged = mergeSessionRecords('s-merged', [a, b])
    expect(merged.durationsMs.FOKUS).toBe(1500)
    expect(merged.durationsMs.TERALIH).toBe(200)
    expect(merged.durationsMs.MENGANTUK).toBe(100)
    expect(merged.durationsMs.TIDAK_HADIR).toBe(0)
    expect(merged.durationsMs.UNCERTAIN).toBe(0)
  })

  it('uncertainMs sums across records', () => {
    const a = record({ uncertainMs: 300 })
    const b = record({ uncertainMs: 150 })
    const merged = mergeSessionRecords('s-merged', [a, b])
    expect(merged.uncertainMs).toBe(450)
  })

  it('recoveryTimesMs concatenates in order', () => {
    const a = record({ recoveryTimesMs: [1000, 2000] })
    const b = record({ recoveryTimesMs: [500] })
    const merged = mergeSessionRecords('s-merged', [a, b])
    expect(merged.recoveryTimesMs).toEqual([1000, 2000, 500])
  })

  it("second record's distraction spans are offset by the first record's total elapsed time", () => {
    const a = record({
      durationsMs: { ...emptyDurations(), FOKUS: 6000, TERALIH: 4000 }, // 10_000ms elapsed
      distractionEvents: [{ start: 1000, end: 2000 }],
    })
    const b = record({
      distractionEvents: [{ start: 500, end: 800 }],
    })
    const merged = mergeSessionRecords('s-merged', [a, b])
    expect(merged.distractionEvents).toEqual([
      { start: 1000, end: 2000 },
      { start: 10_500, end: 10_800 },
    ])
  })

  it("a third record's spans are offset by the CUMULATIVE elapsed time of both prior records, not just the immediately preceding one", () => {
    const a = record({ durationsMs: { ...emptyDurations(), FOKUS: 10_000 } }) // 10_000ms elapsed
    const b = record({ durationsMs: { ...emptyDurations(), FOKUS: 20_000 } }) // 20_000ms elapsed
    const c = record({
      distractionEvents: [{ start: 500, end: 700 }],
      firstCollapseAtMs: 100,
    })
    const merged = mergeSessionRecords('s-merged', [a, b, c])
    // cumulative offset going into record c is 10_000 + 20_000 = 30_000
    expect(merged.distractionEvents).toEqual([{ start: 30_500, end: 30_700 }])
    expect(merged.firstCollapseAtMs).toBe(30_100)
  })

  it('firstCollapseAtMs: null in both -> null', () => {
    const merged = mergeSessionRecords('s-merged', [record(), record()])
    expect(merged.firstCollapseAtMs).toBeNull()
  })

  it('firstCollapseAtMs: set in the first record -> used as-is', () => {
    const a = record({ firstCollapseAtMs: 3000 })
    const b = record({ firstCollapseAtMs: 500 })
    const merged = mergeSessionRecords('s-merged', [a, b])
    expect(merged.firstCollapseAtMs).toBe(3000)
  })

  it("firstCollapseAtMs: null in the first record, set in the second -> offset by the first record's elapsed time", () => {
    const a = record({ durationsMs: { ...emptyDurations(), FOKUS: 7000 } }) // 7_000ms elapsed
    const b = record({ firstCollapseAtMs: 1200 })
    const merged = mergeSessionRecords('s-merged', [a, b])
    expect(merged.firstCollapseAtMs).toBe(8200)
  })

  it('clarification is always null in the output, even if an input record had one', () => {
    const a = record({ clarification: { answer: 'book' } })
    const merged = mergeSessionRecords('s-merged', [a])
    expect(merged.clarification).toBeNull()
  })

  it('propagates studyTopic from the first record', () => {
    const a = record({ studyTopic: 'Matematika - Integral' })
    const b = record({ studyTopic: 'should be ignored' })
    const merged = mergeSessionRecords('s-merged', [a, b])
    expect(merged.studyTopic).toBe('Matematika - Integral')
  })

  it('leaves studyTopic undefined when records lack it (old sessions stay readable)', () => {
    const merged = mergeSessionRecords('s-merged', [record(), record()])
    expect(merged.studyTopic).toBeUndefined()
  })
})
