/**
 * HACHIKO AI v0.1 — Shared types & enums
 * ======================================
 * Plain JS with JSDoc typedefs so the core runs in the browser with no build
 * step, while editors and `tsc --checkJs` still get full type information.
 */

/**
 * Public AI state. Exactly three values — this is the contract the app layer
 * (v0.4+) will consume. Do not add a fourth without a version bump.
 * @readonly
 */
export const AIState = Object.freeze({
  FOKUS: 'FOKUS',
  TERALIH: 'TERALIH',
  TIDAK_HADIR: 'TIDAK_HADIR',
});

/**
 * Primary reason for the current state.
 *
 * v0.2: PITCH became PITCH_UP (directional), and ABSENCE replaced FACE_MISSING.
 *
 * There is deliberately NO `PITCH_DOWN` and NO `ROLL` member. Those are
 * SUPPORT-only signals: they appear in `activeEvidence` and in telemetry, but
 * can never be a primary reason, because they cannot be distinguished from
 * reading, writing, or a relaxed study posture.
 * @readonly
 */
export const StateReason = Object.freeze({
  NONE: 'NONE',
  YAW: 'YAW',
  PITCH_UP: 'PITCH_UP',
  EYE_CLOSURE: 'EYE_CLOSURE',
  MULTIPLE: 'MULTIPLE',
  /** Sustained inability to observe the user. Reported with TIDAK_HADIR. */
  ABSENCE: 'ABSENCE',
});

/**
 * Manual scenario labels for behavioural acceptance testing.
 *
 * GROUND TRUTH ONLY — annotation of what the human tester was actually doing.
 * This NEVER enters the classification path; the engine cannot read it. It is
 * carried in telemetry under `manualScenarioTruth`, strictly beside (never
 * inside) `classification`, so prediction and truth can be compared offline
 * without either contaminating the other.
 * @readonly
 */
export const ScenarioTruth = Object.freeze({
  NONE: 'NONE',
  SCREEN_NORMAL: 'SCREEN_NORMAL',
  READ_BOOK: 'READ_BOOK',
  WRITE_NOTES: 'WRITE_NOTES',
  LOOK_LEFT_SHORT: 'LOOK_LEFT_SHORT',
  LOOK_LEFT_LONG: 'LOOK_LEFT_LONG',
  LOOK_RIGHT_LONG: 'LOOK_RIGHT_LONG',
  LOOK_UP_SHORT: 'LOOK_UP_SHORT',
  LOOK_UP_LONG: 'LOOK_UP_LONG',
  LOOK_DOWN_LONG: 'LOOK_DOWN_LONG',
  HEAD_TILT: 'HEAD_TILT',
  // v0.2 live gate: roll validated independently of yaw.
  TILT_LEFT: 'TILT_LEFT',
  TILT_RIGHT: 'TILT_RIGHT',
  NORMAL_BLINK: 'NORMAL_BLINK',
  EYES_CLOSED_LONG: 'EYES_CLOSED_LONG',
  FACE_OCCLUDED_SHORT: 'FACE_OCCLUDED_SHORT',
  ABSENT: 'ABSENT',
  RETURN: 'RETURN',
  /**
   * Probe for the absence-flicker question raised by the live gate: hold an
   * extreme head turn while remaining physically present and record whether
   * TIDAK_HADIR is ever wrongly reported. See FaceMissingTracker.
   */
  EXTREME_YAW_HELD_5S: 'EXTREME_YAW_HELD_5S',
});

/**
 * v0.3 presence status — richer than the public 3-state, kept internal.
 *
 * The whole point of v0.3: PRESENT_FACE_UNAVAILABLE is a real, common state
 * (user turned away, hand over face) that v0.2 eventually mislabelled
 * TIDAK_HADIR. It must never become absence.
 * @readonly
 */
export const PresenceStatus = Object.freeze({
  /** Face detected. Sufficient proof of presence on its own. */
  PRESENT: 'PRESENT',
  /** No face, but the primary person is visible. NOT absence. */
  PRESENT_FACE_UNAVAILABLE: 'PRESENT_FACE_UNAVAILABLE',
  /** Neither face nor primary person, but not yet long enough to conclude. */
  MISSING_PENDING: 'MISSING_PENDING',
  /** Sustained loss of both signals. This is the only path to TIDAK_HADIR. */
  ABSENT: 'ABSENT',
});

/**
 * Lifecycle of a phone-use event.
 * @readonly
 */
export const PhoneEventStatus = Object.freeze({
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
});

/**
 * Whether a phone event was study-related.
 *
 * Always PENDING in v0.3. The app (v0.4+) asks the user during a break; the AI
 * never guesses, because a phone can legitimately be a study tool.
 * @readonly
 */
export const PhoneContext = Object.freeze({
  PENDING: 'PENDING',
});

/**
 * Evidence tier. Strong evidence may independently produce TERALIH; support
 * evidence may only corroborate.
 * @readonly
 */
export const EvidenceTier = Object.freeze({
  STRONG: 'STRONG',
  SUPPORT: 'SUPPORT',
});

/**
 * Calibration lifecycle.
 * @readonly
 */
export const CalibrationStatus = Object.freeze({
  UNCALIBRATED: 'UNCALIBRATED',
  COLLECTING: 'COLLECTING',
  VALID: 'VALID',
  FAILED: 'FAILED',
});

/**
 * Why a pose measurement was rejected. Kept explicit so telemetry can explain
 * invalid frames instead of silently emitting 0 degrees — the exact failure
 * mode found in the Python harness (`return 0.0, 0.0` on solvePnP failure).
 * @readonly
 */
export const PoseInvalidReason = Object.freeze({
  NONE: 'NONE',
  NO_FACE: 'NO_FACE',
  NO_MATRIX: 'NO_MATRIX',
  NON_FINITE: 'NON_FINITE',
  DEGENERATE_MATRIX: 'DEGENERATE_MATRIX',
  IMPLAUSIBLE_ANGLE: 'IMPLAUSIBLE_ANGLE',
});

/**
 * @typedef {Object} Measurement  Raw, uncalibrated, per-frame observation.
 * @property {boolean}     facePresent
 * @property {boolean}     poseValid
 * @property {string}      poseInvalidReason  One of PoseInvalidReason.
 * @property {number|null} yawRaw    degrees, null when !poseValid
 * @property {number|null} pitchRaw  degrees, null when !poseValid
 * @property {number|null} rollRaw   degrees, null when !poseValid
 * @property {number|null} earLeft   dimensionless, null when !facePresent
 * @property {number|null} earRight
 * @property {number|null} earMean
 */

/**
 * @typedef {Object} Calibrated  Measurement expressed relative to baseline.
 * @property {number|null} yawDelta     degrees from baseline
 * @property {number|null} pitchDelta   degrees from baseline (v0.2: signed, direction matters)
 * @property {number|null} rollDelta    degrees from baseline (v0.2: added)
 * @property {number|null} earRelative  ratio earMean / earBaseline
 */

/**
 * @typedef {Object} Temporal  Smoothed signals + dropout accounting.
 * @property {number|null} yawSmoothed
 * @property {number|null} pitchSmoothed
 * @property {number|null} earSmoothed
 * @property {number}      faceMissingMs
 */

/**
 * @typedef {Object} ActiveEvidence  Which signals are currently sustained.
 * @property {boolean} yawStrong
 * @property {boolean} pitchUpStrong
 * @property {boolean} eyeClosureStrong
 * @property {boolean} pitchDownSupport
 * @property {boolean} rollSupport
 */

/**
 * @typedef {Object} Classification  Derived state. NEVER a ground-truth label.
 * @property {string} state          One of AIState.
 * @property {string} primaryReason  One of StateReason.
 * @property {string} reason         Alias of primaryReason (v0.1 compatibility).
 * @property {ActiveEvidence} activeEvidence
 * @property {number} stateDurationMs
 */

/**
 * @typedef {Object} Performance
 * @property {number} inferenceMs  Time inside MediaPipe detectForVideo.
 * @property {number} fps          Effective end-to-end frame rate.
 */

/**
 * @typedef {Object} TelemetryFrame  One emitted record.
 * @property {number}         timestampMs
 * @property {Measurement}    measurement
 * @property {Calibrated}     calibrated
 * @property {Temporal}       temporal
 * @property {Classification} classification
 * @property {Performance}    performance
 * @property {Object}         validity
 */

/**
 * Baseline produced by CalibrationEngine.
 * @typedef {Object} Baseline
 * @property {number} yaw
 * @property {number} pitch
 * @property {number} ear
 * @property {number} sampleCount
 * @property {string} status
 */

/**
 * @typedef {Object} ObjectDetection  One accepted detector result.
 * @property {string} category    exact model label ('person' | 'cell phone')
 * @property {number} confidence  0..1
 * @property {{originX:number, originY:number, width:number, height:number}} boundingBox pixels
 * @property {number} timestampMs
 */

/**
 * @typedef {Object} PhoneEvent
 * @property {number} eventId
 * @property {number} startMs
 * @property {number|null} endMs        null while ACTIVE
 * @property {number} durationMs
 * @property {number} confidenceMean
 * @property {number} confidenceMax
 * @property {string} status            one of PhoneEventStatus
 * @property {string} context           one of PhoneContext (always PENDING in v0.3)
 */

export default {
  AIState, StateReason, CalibrationStatus, PoseInvalidReason,
  ScenarioTruth, EvidenceTier, PresenceStatus, PhoneEventStatus, PhoneContext,
};
