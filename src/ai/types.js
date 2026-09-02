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

export default {
  AIState, StateReason, CalibrationStatus, PoseInvalidReason,
  ScenarioTruth, EvidenceTier,
};
