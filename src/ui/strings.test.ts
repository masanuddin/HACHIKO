import { describe, expect, it } from 'vitest'
import { formatDuration, formatFocusLine, sessionTitle, strings } from './strings'

describe('formatDuration', () => {
  it('renders a genuine zero as "0s"', () => {
    expect(formatDuration(0)).toBe('0s')
  })

  it('renders sub-minute durations in seconds', () => {
    expect(formatDuration(5_000)).toBe('5s')
    expect(formatDuration(37_000)).toBe('37s')
    expect(formatDuration(59_000)).toBe('59s')
    expect(formatDuration(59_900)).toBe('59s')
  })

  it('renders exact whole minutes as "Nm 00s"', () => {
    expect(formatDuration(60_000)).toBe('1m 00s')
    expect(formatDuration(120_000)).toBe('2m 00s')
  })

  it('renders a minute with remaining seconds exactly, zero-padded', () => {
    expect(formatDuration(84_000)).toBe('1m 24s')
    expect(formatDuration(119_000)).toBe('1m 59s')
    expect(formatDuration(121_000)).toBe('2m 01s')
  })

  it('renders exact whole hours as "Nh 00m 00s"', () => {
    expect(formatDuration(3_600_000)).toBe('1h 00m 00s')
  })

  it('renders hours with remaining minutes/seconds, zero-padded', () => {
    expect(formatDuration(3_800_000)).toBe('1h 03m 20s')
  })
})

describe('formatDuration boundaries', () => {
  it('covers the full second/minute/hour boundary ladder', () => {
    expect(formatDuration(2_000)).toBe('2s')
    expect(formatDuration(36_000)).toBe('36s')
    expect(formatDuration(59_000)).toBe('59s')
    expect(formatDuration(60_000)).toBe('1m 00s')
    expect(formatDuration(84_000)).toBe('1m 24s')
    expect(formatDuration(119_000)).toBe('1m 59s')
    expect(formatDuration(120_000)).toBe('2m 00s')
    expect(formatDuration(121_000)).toBe('2m 01s')
    expect(formatDuration(3_599_000)).toBe('59m 59s')
    expect(formatDuration(3_600_000)).toBe('1h 00m 00s')
    expect(formatDuration(3_661_000)).toBe('1h 01m 01s')
  })
})

describe('sessionTitle', () => {
  it('personalises the title with the student name', () => {
    expect(sessionTitle('Rafael Komala')).toBe('Kartu Sesi Rafael Komala')
  })

  it('falls back to the plain title when the name is missing', () => {
    expect(sessionTitle(undefined)).toBe('Kartu Sesi')
    expect(sessionTitle('')).toBe('Kartu Sesi')
  })

  it('trims surrounding whitespace and never leaves a trailing space', () => {
    expect(sessionTitle('  Rafael  ')).toBe('Kartu Sesi Rafael')
    expect(sessionTitle('   ')).toBe('Kartu Sesi')
  })
})

describe('session card study-topic insight', () => {
  it('names the topic when one exists', () => {
    expect(strings.sessionCard.topicInsight('Matematika')).toBe('Kamu paling fokus pas belajar Matematika')
  })
})

describe('formatFocusLine', () => {
  it('renders an instantly-finished session as "0s dari 0s"', () => {
    expect(formatFocusLine(0, 0)).toBe('0s dari 0s')
  })

  it('renders sub-minute focus and total in seconds', () => {
    expect(formatFocusLine(5_000, 10_000)).toBe('5s dari 10s')
  })

  it('renders 59s in seconds', () => {
    expect(formatFocusLine(59_000, 59_000)).toBe('59s dari 59s')
  })

  it('renders 60s and above in minutes', () => {
    expect(formatFocusLine(60_000, 60_000)).toBe('1m 00s dari 1m 00s')
  })
})

describe('media chips', () => {
  it('expose exactly the five product learning tools', () => {
    expect(Object.keys(strings.media.chips).sort()).toEqual(['book', 'laptop', 'other', 'paper', 'phone'])
  })

  it('do not expose a mixed/campuran option', () => {
    expect('mixed' in strings.media.chips).toBe(false)
    expect(Object.values(strings.media.chips)).not.toContain('Campuran')
  })

  it('asks the study-topic question with the required copy', () => {
    expect(strings.media.topicLabel).toBe('Di sesi ini, kamu mau belajar apa?')
  })
})

describe('session state labels', () => {
  it('map every internal FocusState to the required product label', () => {
    expect(strings.session.stateLabels).toEqual({
      FOKUS: 'Fokus',
      TERALIH: 'Teralih',
      TIDAK_HADIR: 'Tidak di depan laptop',
      UNCERTAIN: 'Teralih',
      MENGANTUK: 'Teralih',
    })
  })

  it('keep all five internal FocusState keys', () => {
    expect(Object.keys(strings.session.stateLabels).sort()).toEqual([
      'FOKUS',
      'MENGANTUK',
      'TERALIH',
      'TIDAK_HADIR',
      'UNCERTAIN',
    ])
  })

  it('never render the live UNCERTAIN label as "Waktu tidak fokus"', () => {
    expect(strings.session.stateLabels.UNCERTAIN).not.toBe('Waktu tidak fokus')
  })
})

describe('analytical uncertain terminology', () => {
  it('keeps the Session Card / PDF "Waktu tidak fokus" metric label', () => {
    expect(strings.sessionCard.notFocusedLabel).toBe('Waktu tidak fokus')
  })
})
