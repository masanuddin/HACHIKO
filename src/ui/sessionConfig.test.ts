import { describe, expect, it } from 'vitest'
import { clampDurationMs, maxBreakMs, DURATION_MIN_MS, DURATION_MAX_MS, BREAK_MAX_RATIO, LONG_BREAK_MAX_RATIO } from './sessionConfig'

describe('clampDurationMs', () => {
  it('passes through a value already inside the range', () => {
    expect(clampDurationMs(25 * 60_000, DURATION_MIN_MS, DURATION_MAX_MS)).toBe(25 * 60_000)
  })

  it('clamps below the minimum up to the minimum', () => {
    expect(clampDurationMs(0, DURATION_MIN_MS, DURATION_MAX_MS)).toBe(DURATION_MIN_MS)
  })

  it('clamps above the maximum down to the maximum', () => {
    expect(clampDurationMs(999 * 60_000, DURATION_MIN_MS, DURATION_MAX_MS)).toBe(DURATION_MAX_MS)
  })

  it('does not round an in-range value to the nearest whole minute', () => {
    expect(clampDurationMs(90_000, DURATION_MIN_MS, DURATION_MAX_MS)).toBe(90_000)
  })

  it('clamps a below-minimum sub-minute value up to the minimum, same as any other too-low value - callers that want a preset like FAST_DEBUG_WORK_MS (30s) to bypass this floor must not route it through clampDurationMs at all', () => {
    expect(clampDurationMs(30_000, DURATION_MIN_MS, DURATION_MAX_MS)).toBe(DURATION_MIN_MS)
  })

  it('respects a caller-supplied max lower than DURATION_MAX_MS', () => {
    expect(clampDurationMs(20 * 60_000, DURATION_MIN_MS, 10 * 60_000)).toBe(10 * 60_000)
  })
})

describe('maxBreakMs', () => {
  it('is a ratio of the work duration when that is below the absolute ceiling', () => {
    expect(maxBreakMs(25 * 60_000, BREAK_MAX_RATIO)).toBe(25 * 60_000 * 0.5)
  })

  it('never exceeds DURATION_MAX_MS even for a work duration whose ratio share would otherwise be larger', () => {
    // In real usage the work-duration stepper itself never exceeds
    // DURATION_MAX_MS (60 min), so this ceiling never actually engages
    // in practice - but maxBreakMs is a pure function and must still be
    // correct for any input on its own terms, independent of how its
    // one current caller happens to use it.
    expect(maxBreakMs(200 * 60_000, LONG_BREAK_MAX_RATIO)).toBe(DURATION_MAX_MS)
  })

  it('the default 5-minute short break and 15-minute long break both fit under a 25-minute work default', () => {
    const workMs = 25 * 60_000
    expect(5 * 60_000).toBeLessThanOrEqual(maxBreakMs(workMs, BREAK_MAX_RATIO))
    expect(15 * 60_000).toBeLessThanOrEqual(maxBreakMs(workMs, LONG_BREAK_MAX_RATIO))
  })
})
