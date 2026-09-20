import { describe, expect, it } from 'vitest'
import { formatDuration, sessionTitle, strings } from './strings'

describe('formatDuration', () => {
  it('renders a genuine zero as "00:00:00"', () => {
    expect(formatDuration(0)).toBe('00:00:00')
  })

  it('renders sub-minute durations with zero-padded hours/minutes', () => {
    expect(formatDuration(5_000)).toBe('00:00:05')
    expect(formatDuration(37_000)).toBe('00:00:37')
    expect(formatDuration(59_000)).toBe('00:00:59')
    expect(formatDuration(59_900)).toBe('00:00:59')
  })

  it('renders exact whole minutes with zero seconds', () => {
    expect(formatDuration(60_000)).toBe('00:01:00')
    expect(formatDuration(120_000)).toBe('00:02:00')
  })

  it('renders a minute with remaining seconds exactly, zero-padded', () => {
    expect(formatDuration(84_000)).toBe('00:01:24')
    expect(formatDuration(119_000)).toBe('00:01:59')
    expect(formatDuration(121_000)).toBe('00:02:01')
  })

  it('renders exact whole hours with zero minutes/seconds', () => {
    expect(formatDuration(3_600_000)).toBe('01:00:00')
  })

  it('renders hours with remaining minutes/seconds, zero-padded', () => {
    expect(formatDuration(3_800_000)).toBe('01:03:20')
  })
})

describe('formatDuration boundaries', () => {
  it('covers the full second/minute/hour boundary ladder', () => {
    expect(formatDuration(2_000)).toBe('00:00:02')
    expect(formatDuration(36_000)).toBe('00:00:36')
    expect(formatDuration(59_000)).toBe('00:00:59')
    expect(formatDuration(60_000)).toBe('00:01:00')
    expect(formatDuration(84_000)).toBe('00:01:24')
    expect(formatDuration(119_000)).toBe('00:01:59')
    expect(formatDuration(120_000)).toBe('00:02:00')
    expect(formatDuration(121_000)).toBe('00:02:01')
    expect(formatDuration(3_599_000)).toBe('00:59:59')
    expect(formatDuration(3_600_000)).toBe('01:00:00')
    expect(formatDuration(3_661_000)).toBe('01:01:01')
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

  it('never render the live UNCERTAIN label as the report\'s "Waktu teralih" metric label', () => {
    expect(strings.session.stateLabels.UNCERTAIN).not.toBe('Waktu teralih')
  })
})

describe('analytical uncertain terminology', () => {
  it('keeps the Session Card / PDF "Waktu teralih" metric label', () => {
    expect(strings.sessionCard.notFocusedLabel).toBe('Waktu teralih')
  })
})
