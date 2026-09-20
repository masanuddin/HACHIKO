import { describe, expect, it } from 'vitest'
import { calibrate, DEFAULT_CONFIG } from './focusEngine'
import type { Frame } from './focusEngine'

const STEP_MS = 200 // 5fps

function frame(t: number, yaw: number, pitch: number): Frame {
  return { t, faceFound: true, yaw, pitch, eyeBlink: 0, objects: [] }
}

describe('calibrate', () => {
  it('discards the first 3000ms and computes mean/tolerance from the rest', () => {
    const frames: Frame[] = []
    let t = 0
    // First 3s: wild outlier that must NOT influence the result.
    for (; t < 3000; t += STEP_MS) frames.push(frame(t, 5, 5))
    // Remaining 12s: a tight, symmetric spread around (0.1, -0.05).
    const settled = [0.08, 0.1, 0.12, 0.1, 0.09, 0.11, 0.1, 0.1]
    let i = 0
    for (; t < 15000; t += STEP_MS) {
      const delta = settled[i % settled.length]! - 0.1
      frames.push(frame(t, 0.1 + delta, -0.05 + delta))
      i += 1
    }

    const cone = calibrate(frames, DEFAULT_CONFIG)

    expect(cone.yawMid).toBeCloseTo(0.1, 1)
    expect(cone.pitchMid).toBeCloseTo(-0.05, 1)
    // The outlier is excluded, so tolerance stays small and hits the floor.
    expect(cone.yawTol).toBeCloseTo(DEFAULT_CONFIG.coneFloorRad, 5)
  })

  it('applies the coneFloorRad floor for a very still student', () => {
    const frames: Frame[] = []
    let t = 0
    for (; t < 15000; t += STEP_MS) frames.push(frame(t, 0, 0))

    const cone = calibrate(frames, DEFAULT_CONFIG)

    // Zero variance would otherwise produce an impossibly tight cone.
    expect(cone.yawTol).toBe(DEFAULT_CONFIG.coneFloorRad)
    expect(cone.pitchTol).toBe(DEFAULT_CONFIG.coneFloorRad)
  })

  it('widens the tolerance beyond the floor for a genuinely restless sample', () => {
    const frames: Frame[] = []
    let t = 0
    const swing = [0.4, -0.4, 0.4, -0.4]
    let i = 0
    for (; t < 15000; t += STEP_MS) {
      frames.push(frame(t, swing[i % swing.length]!, 0))
      i += 1
    }

    const cone = calibrate(frames, DEFAULT_CONFIG)

    expect(cone.yawTol).toBeGreaterThan(DEFAULT_CONFIG.coneFloorRad)
  })

  it('ignores frames where the face was not found', () => {
    const frames: Frame[] = []
    let t = 0
    for (; t < 3000; t += STEP_MS) frames.push(frame(t, 0, 0))
    for (; t < 10000; t += STEP_MS) {
      frames.push({ t, faceFound: false, yaw: null, pitch: null, eyeBlink: null, objects: [] })
    }
    for (; t < 15000; t += STEP_MS) frames.push(frame(t, 0.1, 0.1))

    const cone = calibrate(frames, DEFAULT_CONFIG)

    expect(cone.yawMid).toBeCloseTo(0.1, 5)
  })

  it('throws with no frames', () => {
    expect(() => calibrate([], DEFAULT_CONFIG)).toThrow()
  })

  it('throws when every frame falls inside the discarded settling window', () => {
    const frames = [frame(0, 0, 0), frame(1000, 0, 0), frame(2000, 0, 0)]
    expect(() => calibrate(frames, DEFAULT_CONFIG)).toThrow()
  })
})
