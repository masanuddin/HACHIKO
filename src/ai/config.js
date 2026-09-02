/**
 * HACHIKO AI v0.1 — Central Configuration
 * =======================================
 * SINGLE SOURCE OF TRUTH for every threshold, timing, and tunable in the AI core.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ PROVISIONAL — must be revalidated after pilot.                        │
 * │                                                                       │
 * │ Every numeric value in this file is a PROVISIONAL STARTING POINT      │
 * │ chosen only to give the engine a functioning baseline. None of these  │
 * │ numbers are scientifically validated for HACHIKO's target population  │
 * │ (Indonesian junior-high students, ages 12-15).                        │
 * │                                                                       │
 * │ Do NOT cite these as validated thresholds. Do NOT copy them into      │
 * │ other files. Import from here.                                        │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Historical note: the Python research harness (baseline_detection.py) used
 * ABSOLUTE thresholds (|yaw| > 30 deg, EAR < 0.21). Analysis of its log
 * (log_20260820_112600.csv) showed median EAR = 0.20 against a 0.21 threshold,
 * i.e. the threshold split the subject's distribution nearly in half. That is
 * why v0.1 uses CALIBRATED RELATIVE measures (deltas / ratios) instead.
 */

/** Deep-frozen so no module can mutate shared config at runtime. */
function deepFreeze(obj) {
  for (const key of Object.getOwnPropertyNames(obj)) {
    const value = obj[key];
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj);
}

export const CONFIG = deepFreeze({
  // ── MediaPipe Face Landmarker ──────────────────────────────────────────
  landmarker: {
    // Bundled locally (see scripts/fetch-assets.mjs) so the harness works
    // offline and does not depend on a third-party CDN at runtime.
    modelAssetPath: './assets/face_landmarker.task',
    wasmPath: './assets/wasm',
    delegate: 'GPU',            // PROVISIONAL — falls back to CPU automatically.
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,  // PROVISIONAL — must be revalidated after pilot.
    minFacePresenceConfidence: 0.5,   // PROVISIONAL — must be revalidated after pilot.
    minTrackingConfidence: 0.5,       // PROVISIONAL — must be revalidated after pilot.
    // Required for head pose: yields the 4x4 facial transformation matrix.
    outputFacialTransformationMatrixes: true,
    outputFaceBlendshapes: false,     // Not needed in v0.1. Costs time; keep off.
  },

  // ── Camera ─────────────────────────────────────────────────────────────
  camera: {
    width: 640,
    height: 480,
    facingMode: 'user',
    targetFps: 30,
    /**
     * The debug preview is mirrored for user comfort (like a mirror), but the
     * frame sent to MediaPipe is NEVER mirrored. The Python harness called
     * cv2.flip(frame, 1) BEFORE inference, which silently negated yaw and left
     * its sign convention undefined. We keep inference on the unflipped frame
     * so yaw sign is well-defined; only CSS mirrors the preview.
     */
    mirrorPreviewOnly: true,
  },

  // ── Head pose ──────────────────────────────────────────────────────────
  headPose: {
    /**
     * MediaPipe emits the facial transformation matrix as a MatrixData proto
     * (flat `data` + `rows`/`columns`), which is COLUMN-MAJOR. We verify this
     * at runtime rather than trusting it — see HeadPoseExtractor.
     */
    matrixLayout: 'auto',   // 'auto' | 'column-major' | 'row-major'
    /**
     * ── CANONICAL HEAD-POSE CONVENTION ────────────────────────────────────
     * These flags are the SINGLE canonicalization boundary. They are applied
     * inside HeadPoseExtractor, so every value downstream — yawRaw/pitchRaw/
     * rollRaw, the calibrated deltas, smoothing, evidence, state, telemetry —
     * is already canonical. No comparison anywhere else may compensate for a
     * device's raw axis direction.
     *
     * CANONICAL (right-handed, camera facing the user, UNMIRRORED frame):
     *   yaw   > 0  => subject turns to THEIR OWN LEFT (appears right in frame)
     *   pitch > 0  => subject looks UP
     *   pitch < 0  => subject looks DOWN
     *   roll  > 0  => subject tilts toward THEIR OWN RIGHT shoulder
     *
     * invertPitch: TRUE — set from real Gate-1 webcam evidence, not theory.
     * MediaPipe's facial transformation matrix on this rig emits pitch with the
     * OPPOSITE sign to the canonical convention:
     *
     *   physical LOOK UP    -> MediaPipe pitch delta ~ -46.4 deg
     *   physical LOOK DOWN  -> MediaPipe pitch delta ~ +21.8 deg
     *
     * Left uncorrected, PITCH_UP (strong) and PITCH_DOWN (support) evidence are
     * exactly swapped: looking down at a book would accumulate STRONG evidence
     * and could trigger TERALIH, while looking up would be treated as
     * study-compatible. Flipping here fixes both in one place.
     *
     * If a different camera/driver reports the opposite raw sign, re-run Gate 1
     * and change this flag — never the comparisons in EvidenceEngine.
     */
    invertYaw: false,
    invertPitch: true,
    invertRoll: false,
    /**
     * Reject physically implausible poses. Guards against the degenerate
     * gimbal/wrap solutions that corrupted 98.5% of the Python harness's pitch.
     * PROVISIONAL — must be revalidated after pilot.
     */
    maxPlausibleYawDeg: 90,
    maxPlausiblePitchDeg: 75,
    maxPlausibleRollDeg: 75,
  },

  // ── Eye / EAR ──────────────────────────────────────────────────────────
  eye: {
    /**
     * Landmark indices, MediaPipe 468-point topology. Same sets the Python
     * harness used, ordered [corner, upper1, upper2, corner, lower2, lower1]
     * for the Soukupova-Cech formula.
     */
    rightEyeIndices: [33, 160, 158, 133, 153, 144],
    leftEyeIndices: [362, 385, 387, 263, 373, 380],
    /**
     * The Python harness scaled landmark x by w and y by h independently, so
     * EAR depended on frame aspect ratio (a 640x480 EAR was not comparable to
     * a 1280x720 one). We scale BOTH axes by the same factor, making EAR a
     * true dimensionless ratio, comparable across resolutions and devices.
     */
    aspectCorrect: true,

    /**
     * ── EYE-EVIDENCE ELIGIBILITY (v0.2 live-gate fix) ─────────────────────
     * EAR is a projected 2D ratio, so it degrades as the head rotates away
     * from the camera — the eye foreshortens even while fully open. Real
     * Gate-1 webcam data, eyes open throughout:
     *
     *   neutral      earRelative ~ 1.055
     *   look up      earRelative ~ 0.667   <- below the 0.70 closure threshold
     *   look down    earRelative ~ 0.220   <- far below it
     *   extreme yaw  earLeft ~ 1.053 vs earRight ~ 0.557 (one eye foreshortened)
     *
     * Lowering EAR_RELATIVE_THRESHOLD would NOT fix this: at look-down the open
     * eye reads 0.220, below any threshold that still detects real closure. The
     * measurement is not noisy, it is INVALID at that geometry.
     *
     * So EAR is always measured and always logged, but it may only CONTRIBUTE
     * EVIDENCE when the head is near-frontal enough for the ratio to mean what
     * we think it means. Ineligible frames neither accumulate nor sustain
     * eye-closure evidence.
     *
     * All values PROVISIONAL — must be revalidated after pilot. They are
     * engineering limits chosen from one rig's Gate-1 run, not validated
     * physiology.
     */
    eligibility: {
      /** Beyond this |yawDelta| one eye foreshortens; EAR stops being comparable. */
      EYE_MAX_ABS_YAW_DEG: 20,     // PROVISIONAL — must be revalidated after pilot.
      /** Beyond this |pitchDelta| the lid aperture is projected away. */
      EYE_MAX_ABS_PITCH_DEG: 15,   // PROVISIONAL — must be revalidated after pilot.
      /**
       * Left/right agreement check. Both eyes should read similarly when the
       * head is frontal; a large asymmetry means one eye is occluded or
       * foreshortened, so the mean is not trustworthy. Compared as a ratio of
       * larger:smaller, so it is scale-free.
       * Observed at extreme yaw: 1.053 / 0.557 = 1.89.
       */
      EYE_MAX_LR_RATIO: 1.6,       // PROVISIONAL — must be revalidated after pilot.
      enableLrConsistencyCheck: true,
      /**
       * The ratio test is only meaningful once the eyes are open enough for the
       * denominator to be stable. With both eyes genuinely SHUT the readings are
       * near zero, where a trivial absolute difference explodes the ratio:
       * L=0.005 vs R=0.016 is only 0.011 apart but a 3.2x ratio, and would be
       * rejected as "asymmetric" even though both eyes are simply closed.
       *
       * So the ratio check is skipped when BOTH eyes are below this value —
       * bilateral near-zero is agreement, not disagreement. One eye above and
       * one below still gets checked, which is the real occlusion case.
       */
      EYE_LR_RATIO_MIN_EAR: 0.05,  // PROVISIONAL — must be revalidated after pilot.
      /**
       * Upper plausibility bound only. An EAR above this cannot come from a
       * real eye and indicates a bad landmark solve.
       *
       * THERE IS DELIBERATELY NO PHYSIOLOGICAL LOWER BOUND. A near-zero EAR is
       * exactly what a genuinely closed eye looks like, so rejecting it as
       * "implausible" would discard the signal this feature exists to detect.
       * A real Gate-1 closure measured L=0.016 R=0.016 (earRelative 0.040) and
       * was wrongly rejected by a 0.02 lower bound.
       *
       * Only impossible values are rejected: negative, or non-finite. That is a
       * MEASUREMENT-VALIDITY test, kept strictly separate from the
       * CLASSIFICATION threshold (EAR_RELATIVE_THRESHOLD), which decides
       * whether a valid low reading counts as closure.
       */
      EYE_MIN_VALID_EAR: 0,        // >= 0; only impossible values are rejected.
      EYE_MAX_PLAUSIBLE_EAR: 1.20, // PROVISIONAL — must be revalidated after pilot.
    },
  },

  // ── Calibration ────────────────────────────────────────────────────────
  calibration: {
    CALIBRATION_DURATION_MS: 5000,
    /** Below this many valid samples the baseline is not trustworthy. */
    minValidSamples: 30,          // PROVISIONAL — must be revalidated after pilot.
    /** Fraction of collected frames that must be valid to accept a baseline. */
    minValidRatio: 0.5,           // PROVISIONAL — must be revalidated after pilot.
    /** Guard against a baseline captured while already looking away. */
    maxBaselineYawSpreadDeg: 20,  // PROVISIONAL — must be revalidated after pilot.
    maxBaselinePitchSpreadDeg: 20,// PROVISIONAL — must be revalidated after pilot.
    /** EAR baseline below this implies eyes were shut during calibration. */
    minBaselineEar: 0.10,         // PROVISIONAL — must be revalidated after pilot.
  },

  // ── Temporal smoothing ─────────────────────────────────────────────────
  temporal: {
    EMA_ALPHA: 0.35,              // PROVISIONAL — must be revalidated after pilot.
    /**
     * Frame-rate compensation. An EMA with fixed alpha changes its effective
     * time constant when FPS drifts (a real risk on low-end laptops, v0.5).
     * When true, alpha adapts to the actual frame interval so the smoothing
     * half-life stays constant in TIME, not in frames.
     */
    frameRateCompensate: true,
    /** Reference rate at which EMA_ALPHA applies literally. */
    referenceFps: 30,
    /** Ignore absurd frame gaps (tab throttled, laptop suspended). */
    maxFrameDeltaMs: 500,         // PROVISIONAL — must be revalidated after pilot.
  },

  // ── State engine: hierarchical evidence model (v0.2) ───────────────────
  /**
   * v0.2 replaces v0.1's flat `yaw OR pitch OR eyeClosure` disjunction with a
   * TIERED model. Features are NOT equivalent boolean triggers:
   *
   *   STRONG   evidence may INDEPENDENTLY produce TERALIH after persistence.
   *   SUPPORT  evidence may NEVER independently produce TERALIH. It is measured,
   *            logged, and exposed, and it can corroborate strong evidence, but
   *            on its own it always resolves to FOKUS.
   *
   * The asymmetry is behavioural, not arbitrary. Downward pitch and head roll
   * are exactly what reading, writing and thinking look like; treating them as
   * triggers would punish studying. Upward pitch has no comparable
   * study-compatible explanation at a desk, so it is treated as strong.
   */
  state: {
    // ── STRONG: yaw ──────────────────────────────────────────────────────
    /** Sustained |yawDelta| beyond this is strong diversion evidence. */
    STRONG_YAW_DELTA_DEG: 25,     // PROVISIONAL — must be revalidated after pilot.
    YAW_PERSIST_MS: 1500,         // PROVISIONAL — must be revalidated after pilot.

    // ── STRONG: upward pitch ─────────────────────────────────────────────
    /**
     * Directional. Only UPWARD deviation counts, using the sign convention in
     * docs/HEAD_POSE_CONVENTION.md (pitch > 0 = looking up). If live sign
     * validation shows the axis inverted, fix it once via headPose.invertPitch
     * rather than flipping comparisons here.
     */
    STRONG_UP_PITCH_DELTA_DEG: 30, // PROVISIONAL — must be revalidated after pilot.
    PITCH_UP_PERSIST_MS: 2000,     // PROVISIONAL — must be revalidated after pilot.

    // ── STRONG: sustained eye closure ────────────────────────────────────
    EAR_RELATIVE_THRESHOLD: 0.70, // ratio. PROVISIONAL — must be revalidated after pilot.
    /**
     * Raised 2000 -> 3000 ms in v0.2. At 2 s this fired on long thinking
     * pauses. Still a behavioural/disengagement proxy, never a cognitive claim.
     */
    EYE_CLOSED_PERSIST_MS: 3000,  // PROVISIONAL — must be revalidated after pilot.

    // ── SUPPORT ONLY: downward pitch ─────────────────────────────────────
    /**
     * Reading / writing / looking at notes. Recorded and exposed as supporting
     * evidence; CANNOT trigger TERALIH alone and is never a primaryReason.
     */
    DOWN_PITCH_SUPPORT_DEG: 25,   // PROVISIONAL — must be revalidated after pilot.
    DOWN_PITCH_SUPPORT_PERSIST_MS: 2000, // PROVISIONAL — must be revalidated after pilot.

    // ── SUPPORT ONLY: roll ───────────────────────────────────────────────
    /** Head tilt occurs constantly during valid study. Support only. */
    ROLL_SUPPORT_DEG: 22,         // PROVISIONAL — must be revalidated after pilot (range 20-25).
    ROLL_SUPPORT_PERSIST_MS: 2000, // PROVISIONAL — must be revalidated after pilot.

    // ── Presence ─────────────────────────────────────────────────────────
    FACE_MISSING_ENTER_MS: 2000,  // PROVISIONAL — must be revalidated after pilot.
    FACE_PRESENT_RECOVER_MS: 500, // PROVISIONAL — must be revalidated after pilot.

    STATE_RECOVERY_MS: 750,       // PROVISIONAL — must be revalidated after pilot.

    /**
     * Evidence switches. Strong sources can be disabled for A/B measurement
     * during the pilot; support sources can be muted from telemetry.
     *
     * Note there is deliberately NO switch that promotes a support source to
     * strong. Doing so is a rule change, made in EvidenceEngine, not a config
     * toggle — it must not be possible to punish reading by flipping a boolean.
     */
    enableYawEvidence: true,
    enablePitchUpEvidence: true,
    enableEyeClosureEvidence: true,
    enableDownPitchSupport: true,
    enableRollSupport: true,
  },

  // ── Signal validity / grace ────────────────────────────────────────────
  validity: {
    /**
     * When measurement is momentarily invalid (pose solve failed, landmarks
     * jittered) we HOLD the previous state rather than force a transition.
     */
    SIGNAL_INVALID_GRACE_MS: 1000, // PROVISIONAL — must be revalidated after pilot.
    /** Without a valid calibration the engine reports FOKUS but flags it. */
    requireCalibrationForEvidence: true,
  },

  // ── Telemetry ──────────────────────────────────────────────────────────
  telemetry: {
    enabled: true,
    /** Ring-buffer capacity. ~30 fps * 600 s = 18000 frames. */
    maxFrames: 18000,
    /**
     * PRIVACY INVARIANT: the telemetry layer stores DERIVED NUMBERS ONLY.
     * No frame, ImageData, canvas, blob, or data URL is ever retained.
     * Enforced at runtime by TelemetryLogger.
     */
    storeImages: false,
  },
});

/**
 * Build a config override for tests / experiments without mutating CONFIG.
 * Shallow-merges one level deep per section, which is all the shape needs.
 */
export function withOverrides(overrides = {}) {
  const merged = structuredClone({
    landmarker: CONFIG.landmarker,
    camera: CONFIG.camera,
    headPose: CONFIG.headPose,
    eye: CONFIG.eye,
    calibration: CONFIG.calibration,
    temporal: CONFIG.temporal,
    state: CONFIG.state,
    validity: CONFIG.validity,
    telemetry: CONFIG.telemetry,
  });
  for (const [section, values] of Object.entries(overrides)) {
    merged[section] = { ...(merged[section] ?? {}), ...values };
  }
  return deepFreeze(merged);
}

export default CONFIG;
