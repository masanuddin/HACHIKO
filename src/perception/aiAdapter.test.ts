import { describe, expect, it } from 'vitest'
import { toFrame, type AiDetection, type AiTelemetryFrame } from './aiAdapter'

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

function telemetry(overrides: DeepPartial<AiTelemetryFrame> = {}): AiTelemetryFrame {
  const { timestampMs = 1000, measurement, calibrated, objects, presence } = overrides
  const { detections: detectionsOverride, ...restObjects } = objects ?? {}
  return {
    timestampMs,
    measurement: { facePresent: true, yawRaw: 0, pitchRaw: 0, rollRaw: 0, earMean: 0.25, ...measurement },
    calibrated: { earRelative: 1, ...calibrated },
    objects: {
      phonePresent: false,
      primaryPersonPresent: true,
      detectorRan: true,
      detections: (detectionsOverride as AiDetection[] | undefined) ?? [],
      ...restObjects,
    },
    presence: { status: 'PRESENT', ...presence },
  }
}

describe('toFrame', () => {
  it('passes the AI timestamp through as t in ms', () => {
    expect(toFrame(telemetry({ timestampMs: 4242 })).t).toBe(4242)
  })

  it('converts canonical AI degrees to radians', () => {
    const frame = toFrame(telemetry({ measurement: { facePresent: true, yawRaw: 90, pitchRaw: -45 } }))
    expect(frame.yaw).toBeCloseTo(Math.PI / 2)
    expect(frame.pitch).toBeCloseTo(-Math.PI / 4)
  })

  it('keeps null pose values null (never coerces to zero)', () => {
    const frame = toFrame(telemetry({ measurement: { facePresent: false, yawRaw: null, pitchRaw: null } }))
    expect(frame.yaw).toBeNull()
    expect(frame.pitch).toBeNull()
  })

  it('maps AI presence semantics onto faceFound', () => {
    expect(toFrame(telemetry({ presence: { status: 'PRESENT' } })).faceFound).toBe(true)
    expect(toFrame(telemetry({ presence: { status: 'PRESENT_FACE_UNAVAILABLE' } })).faceFound).toBe(true)
    expect(toFrame(telemetry({ presence: { status: 'MISSING_PENDING' } })).faceFound).toBe(true)
    expect(toFrame(telemetry({ presence: { status: 'ABSENT' } })).faceFound).toBe(false)
  })

  it('maps earRelative to the eyeBlink compatibility field with clamping', () => {
    expect(toFrame(telemetry({ calibrated: { earRelative: 1 } })).eyeBlink).toBe(0)
    expect(toFrame(telemetry({ calibrated: { earRelative: 0.04 } })).eyeBlink).toBeCloseTo(0.96)
    expect(toFrame(telemetry({ calibrated: { earRelative: 1.5 } })).eyeBlink).toBe(0)
    expect(toFrame(telemetry({ calibrated: { earRelative: -0.2 } })).eyeBlink).toBe(1)
  })

  it('leaves eyeBlink null while the AI baseline is unavailable', () => {
    expect(toFrame(telemetry({ calibrated: { earRelative: null } })).eyeBlink).toBeNull()
  })

  it('emits the cell phone label only while the AI phone tracker reports presence', () => {
    expect(toFrame(telemetry({ objects: { phonePresent: true } })).objects).toEqual(['cell phone'])
    expect(toFrame(telemetry({ objects: { phonePresent: false } })).objects).toEqual([])
  })
})
