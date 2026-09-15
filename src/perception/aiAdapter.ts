import type { Frame } from '../engine/types'

/**
 * Thin bridge between the vendored AI-Engine TelemetryFrame and the HACHIKO
 * FocusEngine Frame contract. The FocusEngine is the sole authority on the
 * final state; this module ONLY translates perception data. It never decides
 * a state, never invents evidence, and never turns a phone detection into a
 * verdict on its own.
 *
 * The interfaces below mirror the subset of `HachikoAI.processFrame`'s return
 * shape (src/ai/HachikoAI.js) that HACHIKO consumes. They are declared
 * structurally here so this module stays a plain, unit-testable TypeScript
 * contract against the vendored JavaScript core.
 */

export interface AiMeasurement {
  facePresent: boolean
  yawRaw: number | null // canonical degrees (AI-Engine sign convention)
  pitchRaw: number | null // canonical degrees
  rollRaw: number | null // canonical degrees
  earMean: number | null // dimensionless EAR, always measured when face present
  earLeft?: number | null
  earRight?: number | null
}

export interface AiCalibrated {
  earRelative: number | null // earMean / session baseline; null while uncalibrated
}

export interface AiDetectionBox {
  originX: number
  originY: number
  width: number
  height: number
}

export interface AiDetection {
  category: string // 'person' | 'cell phone'
  confidence: number // 0..1
  /** Pixel box from the detector; null when the model returned none. */
  boundingBox: AiDetectionBox | null
}

/**
 * Unfiltered model output retained by ObjectDetectorEngine diagnostics
 * (diagnostics.lastRawDetections). Observation only - never a pipeline input.
 */
export interface AiRawDetection {
  index: number
  categoryName: string | null
  displayName: string | null
  score: number
  boundingBox: AiDetectionBox | null
  timestampMs: number
}

/**
 * Snapshot of ObjectDetectorEngine.getDiagnostics(). Mentor/debug rendering
 * only; the shape mirrors the vendored engine's diagnostics object.
 */
export interface AiObjectDiagnostics {
  objectInferenceCount: number
  lastObjectInferenceTimestamp: number | null
  rawDetectionCount: number
  acceptedDetectionCount: number
  lastRawDetections: AiRawDetection[]
  lastRejectReasons: Record<string, number>
  categoryNameAvailable: boolean | null
  observedCategories: Record<string, number>
  lastInferenceMs: number
  lastVideoWidth: number | null
  lastVideoHeight: number | null
  lastTimestampMs: number | null
}

export interface AiObjects {
  /** Debounced by AI-Engine PhoneEventTracker. */
  phonePresent: boolean
  primaryPersonPresent: boolean
  /** false when the throttled detector did not run this tick. */
  detectorRan: boolean
  detections: AiDetection[]
  phoneConfidence?: number | null
  primaryPersonConfidence?: number | null
}

export interface AiEvidence {
  /** Whether EAR was trustworthy enough this frame to count as evidence. */
  eyeEligible?: boolean
  eyeIneligibleReason?: string | null
}

export interface AiPerformance {
  fps?: number
  faceInferenceMs?: number
  objectInferenceMs?: number
}

export interface AiPhoneEvent {
  activeEventId?: number | null
  activeDurationMs?: number
}

export interface AiSessionContext {
  learningTools: string[]
  declaredIncludesPhone: boolean
}

export interface AiPresence {
  /**
   * AI-Engine PresenceStatus: PRESENT | PRESENT_FACE_UNAVAILABLE |
   * MISSING_PENDING | ABSENT. PresenceFusion is the authority on absence:
   * face loss alone is never ABSENT.
   */
  status: string
}

export interface AiTelemetryFrame {
  timestampMs: number
  measurement: AiMeasurement
  calibrated: AiCalibrated
  objects: AiObjects
  presence: AiPresence
  evidence?: AiEvidence
  performance?: AiPerformance
  phoneEvent?: AiPhoneEvent
  sessionContext?: AiSessionContext | null
}

const DEG_TO_RAD = Math.PI / 180
const PHONE_LABEL = 'cell phone'

function clamp01(v: number): number {
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

/**
 * Map one AI-Engine telemetry frame into the existing HACHIKO Frame.
 *
 * - t        : AI timestampMs, already in HACHIKO's ms convention.
 * - faceFound: derived from AI PresenceFusion, not raw landmark presence, so
 *              a temporary face-landmark loss (user turned, hand over face)
 *              can never become a hard TIDAK_HADIR signal. Only the AI's
 *              concluded ABSENT state reports faceFound false; FocusEngine
 *              then applies its own absence persistence.
 * - yaw/pitch: AI emits canonical DEGREES; FocusEngine expects RADIANS.
 *              The AI-Engine sign convention is preserved untouched.
 * - eyeBlink : compatibility mapping ONLY - EAR is not a blendshape blink.
 *              earRelative ~1 with eyes open => eyeBlink ~0; sustained
 *              closure drives earRelative toward 0 => eyeBlink toward 1,
 *              which is what FocusEngine's drowsiness accumulator expects.
 *              Null while the AI baseline is unavailable (eyes can then
 *              simply not contribute, same as a missing reading).
 * - objects  : the single COCO label FocusEngine knows. Emitted only while
 *              the AI-Engine PhoneEventTracker reports a debounced phone
 *              presence. Phase 4 will add contextual session wiring; the
 *              tracker's own PENDING default is used for now.
 */
export function toFrame(t: AiTelemetryFrame): Frame {
  const m = t.measurement
  const earRelative = t.calibrated.earRelative

  return {
    t: t.timestampMs,
    faceFound: t.presence.status !== 'ABSENT',
    yaw: m.yawRaw === null ? null : m.yawRaw * DEG_TO_RAD,
    pitch: m.pitchRaw === null ? null : m.pitchRaw * DEG_TO_RAD,
    eyeBlink: earRelative === null ? null : clamp01(1 - earRelative),
    objects: t.objects.phonePresent ? [PHONE_LABEL] : [],
  }
}
