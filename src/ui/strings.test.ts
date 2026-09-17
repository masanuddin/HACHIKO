import { describe, expect, it } from 'vitest'
import { formatDuration, formatFocusLine, strings } from './strings'

describe('formatDuration', () => {
  it('renders a genuine zero as "0 detik", not "0 menit"', () => {
    expect(formatDuration(0)).toBe('0 detik')
  })

  it('renders sub-minute durations in seconds', () => {
    expect(formatDuration(5_000)).toBe('5 detik')
    expect(formatDuration(37_000)).toBe('37 detik')
    expect(formatDuration(59_000)).toBe('59 detik')
    expect(formatDuration(59_900)).toBe('59 detik')
  })

  it('renders 60s and above in minutes, floored', () => {
    expect(formatDuration(60_000)).toBe('1 menit')
    expect(formatDuration(90_000)).toBe('1 menit')
    expect(formatDuration(125_000)).toBe('2 menit')
  })
})

describe('formatFocusLine', () => {
  it('renders an instantly-finished session as "0 detik dari 0 detik"', () => {
    expect(formatFocusLine(0, 0)).toBe('0 detik dari 0 detik')
  })

  it('renders sub-minute focus and total in seconds', () => {
    expect(formatFocusLine(5_000, 10_000)).toBe('5 detik dari 10 detik')
  })

  it('renders 59s in seconds', () => {
    expect(formatFocusLine(59_000, 59_000)).toBe('59 detik dari 59 detik')
  })

  it('renders 60s and above in minutes', () => {
    expect(formatFocusLine(60_000, 60_000)).toBe('1 menit dari 1 menit')
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
