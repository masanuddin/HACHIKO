/**
 * HACHIKO v0.3 — Perception model bake-off candidates  (tools/benchmark)
 * =====================================================================
 * EXPERIMENTAL. Lives outside src/ai and is never imported by production code.
 * Nothing here can affect PresenceFusion, PhoneEventTracker, or state.
 *
 * ── WHY A BAKE-OFF ───────────────────────────────────────────────────────
 * Gate-4 diagnostics on EfficientDet-Lite0 INT8 showed the detector working
 * (names resolve, inference runs) but not accurate enough for HACHIKO:
 *   - a real frontal seated person peaked around ~0.11 confidence
 *   - a large, clearly visible phone often produced no detection at all
 *   - irrelevant classes appeared at comparable confidence
 * A person at 0.11 is indistinguishable from noise, so no threshold can rescue
 * it. That is a model-capability problem, so we compare models.
 *
 * INT8 is deliberately NOT the comparison baseline: quantisation is the prime
 * suspect for the confidence collapse, and INT8 weights on a GPU delegate must
 * be de-quantised anyway, so it buys little here.
 *
 * ── THE INDEX TRAP ───────────────────────────────────────────────────────
 * These models do NOT share a label indexing scheme. Read from each model's own
 * embedded labels.txt:
 *
 *   EfficientDet-Lite0/2 : idx 0 = person,  idx 76 = cell phone   (90 labels)
 *   SSD MobileNetV2      : idx 0 = BACKGROUND, idx 1 = person,
 *                          idx 77 = cell phone                    (91 labels)
 *
 * SSD carries a background class, shifting every index by +1. Hardcoding a
 * single index pair across models would silently mis-label everything, so each
 * candidate declares its own indices.
 */

/** Official Google/MediaPipe model host. No third-party mirrors. */
const BASE = 'https://storage.googleapis.com/mediapipe-models';

/**
 * @typedef {Object} Candidate
 * @property {string} id
 * @property {string} label       human-readable name
 * @property {'object'|'pose'} task
 * @property {string} url         official asset URL
 * @property {string} file        local filename under public/assets/bench/
 * @property {number} sizeBytes   verified by HEAD request
 * @property {Object} [labelIndices] per-model class indices (object detectors)
 * @property {string} delegate
 * @property {string} notes
 */

/** @type {Candidate[]} */
export const CANDIDATES = [
  {
    id: 'edl0-f16',
    label: 'EfficientDet-Lite0 float16',
    task: 'object',
    url: `${BASE}/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`,
    file: 'edl0_float16.tflite',
    sizeBytes: 7254339,
    labelIndices: { PERSON: 0, PHONE: 76 },
    delegate: 'GPU',
    notes: 'Same architecture as the failing INT8 build, without quantisation. '
         + 'Isolates "is quantisation the problem?" from "is the model too small?".',
  },
  {
    id: 'edl2-f16',
    label: 'EfficientDet-Lite2 float16',
    task: 'object',
    url: `${BASE}/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite`,
    file: 'edl2_float16.tflite',
    sizeBytes: 12138859,
    labelIndices: { PERSON: 0, PHONE: 76 },
    delegate: 'GPU',
    notes: 'Larger backbone, higher input resolution. Expected to be the '
         + 'strongest on small/angled phones, at a latency cost.',
  },
  {
    id: 'ssd-mnv2-f32',
    label: 'SSD MobileNetV2 float32',
    task: 'object',
    url: `${BASE}/object_detector/ssd_mobilenet_v2/float32/1/ssd_mobilenet_v2.tflite`,
    file: 'ssd_mobilenet_v2_float32.tflite',
    sizeBytes: 11316189,
    // NOTE the +1 offset: this model has a background class at index 0.
    labelIndices: { PERSON: 1, PHONE: 77 },
    delegate: 'GPU',
    notes: 'Different architecture family. Historically strong on person, '
         + 'weaker on small objects. Index offset differs — see header.',
  },
  {
    id: 'pose-lite',
    label: 'Pose Landmarker Lite (presence challenger)',
    task: 'pose',
    url: `${BASE}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
    file: 'pose_landmarker_lite.task',
    sizeBytes: 5777746,
    delegate: 'GPU',
    notes: 'PRESENCE ONLY: "is a body observable?". Landmarks are NEVER used '
         + 'for focus, distraction, or posture — that is explicitly out of '
         + 'scope. Included because body detection may survive the extreme '
         + 'yaw and back-facing cases where a face is lost, which is exactly '
         + 'the P2 failure v0.3 must fix.',
  },
];

/** Shared observation-only score floor. Never a production threshold. */
export const BENCH_SCORE_THRESHOLD = 0.05;
/** Keep enough results to see what competes with the target classes. */
export const BENCH_MAX_RESULTS = 25;

/**
 * STAGE 1 — quick elimination.
 *
 * A short subset that exposes the failure modes fastest. A candidate that
 * cannot find a frontal seated person, or that fires on an empty frame, does
 * not deserve the full 18-scenario matrix.
 */
export const QUICK_PERSON_SCENARIOS = [
  'frontal_seated', 'extreme_yaw', 'back_facing', 'empty_frame',
];
export const QUICK_PHONE_SCENARIOS = [
  'screen_portrait', 'study_distance', 'on_desk', 'no_phone',
];
/** Pose is presence-only, so it runs the person-side subset plus occlusion. */
export const QUICK_POSE_SCENARIOS = [
  'frontal_seated', 'extreme_yaw', 'back_facing', 'face_covered', 'empty_frame',
];

/** Scenario scripts for the live matrix. */
export const PERSON_SCENARIOS = [
  { id: 'frontal_seated', label: 'Frontal seated, upper body', expect: true },
  { id: 'closer', label: 'Closer to camera', expect: true },
  { id: 'farther', label: 'Farther from camera', expect: true },
  { id: 'upper_body_only', label: 'Upper body only (tight crop)', expect: true },
  { id: 'extreme_yaw', label: 'Extreme yaw (face lost, body visible)', expect: true, critical: true },
  { id: 'back_facing', label: 'Back-facing', expect: true, critical: true },
  { id: 'face_covered', label: 'Face covered by hand', expect: true, critical: true },
  { id: 'reading_writing', label: 'Reading / writing posture (head down)', expect: true, critical: true },
  { id: 'empty_frame', label: 'Empty frame (negative control)', expect: false, critical: true },
];

export const PHONE_SCENARIOS = [
  { id: 'screen_portrait', label: 'Screen-facing, portrait', expect: true },
  { id: 'screen_landscape', label: 'Screen-facing, landscape', expect: true },
  { id: 'back_portrait', label: 'Back-facing, portrait', expect: true },
  { id: 'back_landscape', label: 'Back-facing, landscape', expect: true },
  { id: 'near_camera', label: 'Near camera (large in frame)', expect: true },
  { id: 'study_distance', label: 'Normal study distance', expect: true, critical: true },
  { id: 'on_desk', label: 'Resting on desk', expect: true, critical: true },
  { id: 'partly_occluded', label: 'Partially occluded by hand', expect: true, critical: true },
  { id: 'no_phone', label: 'No phone (negative control)', expect: false, critical: true },
];

/**
 * Decision weights, as specified for this bake-off.
 * HACHIKO-specific hard cases outrank generic benchmark accuracy.
 */
export const DECISION_WEIGHTS = Object.freeze({
  accuracy: 0.40,        // recall on the scenarios above
  falsePositives: 0.20,
  latency: 0.15,
  size: 0.10,
  integration: 0.10,
  maintainability: 0.05,
});

export default CANDIDATES;
