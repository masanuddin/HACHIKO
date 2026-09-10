import { describe, expect, it } from 'vitest'
import { formatDuration } from './strings'

describe('formatDuration', () => {
  it('keeps a genuine zero as the existing "0 menit" zero-state', () => {
    expect(formatDuration(0)).toBe('0 menit')
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
