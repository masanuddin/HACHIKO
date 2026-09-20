import { describe, expect, it } from 'vitest'
import { isRawOutOfCone, shouldOfferEarlyBreak, shouldOfferExtension } from './pacing'
import type { Cone, Frame } from '../engine/focusEngine'
import { emptyDurations } from '../storage/sessions'

const CONE: Cone = { yawMid: 0, yawTol: 0.15, pitchMid: 0, pitchTol: 0.15 }
const WORK_MS = 25 * 60_000

describe('shouldOfferEarlyBreak', () => {
  it('never offers before a third of the block has elapsed, even if entirely struggling', () => {
    const elapsedMs = 4 * 60_000 // well under WORK_MS / 3
    const durations = { ...emptyDurations(), TERALIH: elapsedMs }
    expect(shouldOfferEarlyBreak(WORK_MS, WORK_MS - elapsedMs, durations)).toBe(false)
  })

  it('offers once elapsed passes the minimum ratio and struggle share crosses the threshold', () => {
    const elapsedMs = 10 * 60_000
    const durations = { ...emptyDurations(), TERALIH: 6 * 60_000 }
    expect(shouldOfferEarlyBreak(WORK_MS, WORK_MS - elapsedMs, durations)).toBe(true)
  })

  it('does not offer when the struggle share stays under the threshold', () => {
    const elapsedMs = 10 * 60_000
    const durations = { ...emptyDurations(), TERALIH: 2 * 60_000 }
    expect(shouldOfferEarlyBreak(WORK_MS, WORK_MS - elapsedMs, durations)).toBe(false)
  })
})

describe('shouldOfferExtension', () => {
  it('is true only in FOKUS after the extension window has been clean', () => {
    expect(shouldOfferExtension('FOKUS', 3 * 60_000)).toBe(true)
  })

  it('is false if the clean streak has not lasted the full window', () => {
    expect(shouldOfferExtension('FOKUS', 2 * 60_000)).toBe(false)
  })

  it('is false in any non-FOKUS state regardless of duration', () => {
    expect(shouldOfferExtension('TERALIH', 5 * 60_000)).toBe(false)
  })
})

describe('isRawOutOfCone', () => {
  it('is false when yaw or pitch is null', () => {
    const frame: Frame = { t: 0, faceFound: false, yaw: null, pitch: null, eyeBlink: null, objects: [] }
    expect(isRawOutOfCone(frame, CONE)).toBe(false)
  })

  it('is false inside the cone', () => {
    const frame: Frame = { t: 0, faceFound: true, yaw: 0.1, pitch: 0.1, eyeBlink: 0, objects: [] }
    expect(isRawOutOfCone(frame, CONE)).toBe(false)
  })

  it('is true outside the cone on either axis alone', () => {
    const outsideYaw: Frame = { t: 0, faceFound: true, yaw: 0.5, pitch: 0, eyeBlink: 0, objects: [] }
    const outsidePitch: Frame = { t: 0, faceFound: true, yaw: 0, pitch: 0.5, eyeBlink: 0, objects: [] }
    expect(isRawOutOfCone(outsideYaw, CONE)).toBe(true)
    expect(isRawOutOfCone(outsidePitch, CONE)).toBe(true)
  })
})
