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
 *   YOLO26n              : idx 0 = person,  idx 67 = cell phone   (80 labels)
 *
 * SSD carries a background class, shifting every index by +1. YOLO ships the
 * 80-class COCO set with no background and no placeholder rows, so its phone
 * index is 67 — reusing EfficientDet's 76 there resolves to "scissors".
 * Every index above was read back from the model's OWN embedded label map
 * (see `npm run bench:assets`, which re-verifies them on download).
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
 * @property {string} [runtime]   inference engine: mediapipe | litert.js
 * @property {number} [inputWidth]  model input tensor width
 * @property {number} [inputHeight] model input tensor height
 * @property {string} [sourceRelease] upstream release the weights come from
 * @property {string} [sourceMetadataVersion] version embedded in the INSPECTED
 *   source model — evidence about that file, not about a later export
 * @property {string} [exportToolVersion] Ultralytics version that produced the
 *   local artefact; null until the export actually runs
 * @property {string} [browserRuntimeVersion] npm package that runs it in-browser
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
    runtime: 'mediapipe',
    inputWidth: 320, inputHeight: 320,
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
    runtime: 'mediapipe',
    inputWidth: 448, inputHeight: 448,
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
    runtime: 'mediapipe',
    inputWidth: 300, inputHeight: 300,
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
    runtime: 'mediapipe',
    inputWidth: 256, inputHeight: 256,
    delegate: 'GPU',
    notes: 'PRESENCE ONLY: "is a body observable?". Landmarks are NEVER used '
         + 'for focus, distraction, or posture — that is explicitly out of '
         + 'scope. Included because body detection may survive the extreme '
         + 'yaw and back-facing cases where a face is lost, which is exactly '
         + 'the P2 failure v0.3 must fix.',
  },
  {
    id: 'yolo26n',
    label: 'YOLO26n Detect',
    task: 'object',
    // OFFICIAL LiteRT artefact, published by Ultralytics. No local export and
    // no renaming: the file keeps its upstream name so the artefact on disk is
    // traceable to the exact release asset it came from.
    url: 'https://github.com/ultralytics/yolo-flutter-app/releases/download/'
       + 'v0.6.6/yolo26n_w8a32.tflite',
    file: 'yolo26n_w8a32.tflite',
    // Measured from the downloaded artefact, not read off the release page.
    sizeBytes: 2875553,
    // VERIFIED from the model's embedded metadata, not assumed: YOLO uses the
    // 80-class COCO set, so cell phone is 67 and NOT EfficientDet's 76.
    labelIndices: { PERSON: 0, PHONE: 67 },
    // A SECOND RUNTIME. Every other candidate is MediaPipe Tasks Vision, which
    // loads .tflite through its own ObjectDetector. YOLO's tensor layout does
    // not satisfy that contract, so it runs through @ultralytics/yolo on
    // LiteRT.js instead. Only the engine differs — same camera frames, same
    // scenarios, same recording window, same evaluability rules.
    runtime: 'litert.js',
    inputWidth: 640,
    inputHeight: 640,
    // QUANTISATION, stated explicitly. w8a32 = INT8 weights, FP32 activations.
    // It is NOT the float32 graph, and it is NOT full INT8: recording it
    // loosely would invite a false comparison against the float16 MediaPipe
    // candidates, whose numeric precision differs.
    quantization: 'w8a32',
    quantizationNote: 'INT8 weights, FP32 activations',
    // ── PROVENANCE, kept as SEPARATE facts ───────────────────────────
    // Collapsing these lets the artefact inherit a version nothing measured.
    //
    // 1. The release this exact .tflite was published in.
    sourceRepo: 'ultralytics/yolo-flutter-app',
    sourceRelease: 'v0.6.6',
    sourceAsset: 'yolo26n_w8a32.tflite',
    // 2. Verified from the downloaded bytes, not from the release listing.
    sha256: 'd9cef07ce652ccfa9ce58e4ac8a4df98ff037739a9dad20a8afcae21b545df73',
    // 3. Published by Ultralytics, so there is no local export tool.
    exportToolVersion: null,
    exportProvenance: 'official Ultralytics release asset (no local export)',
    // 4. Browser runtime that executes it, pinned in package.json.
    browserRuntimeVersion: '@ultralytics/yolo@0.0.46',
    litertRuntimeVersion: '@litertjs/core@2.5.3',
    // Separately: the class map was cross-read from the FP32 yolo26n.onnx
    // (ultralytics 8.4.38) because this .tflite embeds no label metadata.
    // The runtime supplies the same COCO-80 map at load; see Y23.
    classMapSource: 'yolo26n.onnx (ultralytics-8.4.38) + runtime names map',
    delegate: 'auto',           // webgpu when the adapter works, else cpu
    notes: 'Newer detector family, evaluated on exactly the same protocol. '
         + 'Being newer is not evidence: it is a candidate, not a winner. '
         + 'w8a32 quantisation differs from the float16 MediaPipe builds, so '
         + 'raw confidences are not comparable across the two families.',
  },
];

/**
 * Bake-off trial window. Unlike the Debug Harness — which tests temporal rules
 * and therefore needs per-scenario durations — a Bake-off trial only samples a
 * detector's opinion of a held scene, so one bounded window suits every
 * scenario. The countdown gives the operator time to set the scene BEFORE any
 * data is recorded.
 */
export const BENCH_COUNTDOWN_MS = 3000;
export const BENCH_RECORDING_MS = 3000;

/** Shared observation-only score floor. Never a production threshold. */
export const BENCH_SCORE_THRESHOLD = 0.05;
/** Keep enough results to see what competes with the target classes. */
export const BENCH_MAX_RESULTS = 25;

/**
 * ── CANONICAL OFFICIAL SCENARIO MATRIX ───────────────────────────────────
 * Every candidate runs EVERY scenario for its task, three valid repetitions
 * each. The matrix is not reduced for any candidate — that is what makes the
 * comparison fair, and why there is no "quick subset" any more.
 *
 * `code` is the stable identifier used in reports (P01…, H01…); `id` stays the
 * lowercase key already present in recorded data.
 */
/** Valid repetitions each benchmark scenario needs. */
export const BENCH_REQUIRED_REPETITIONS = 3;

/**
 * PRESENCE matrix, P01–P10. ONE canonical list, shared by every candidate.
 *
 * Object detectors read it as "is a PERSON visible"; Pose Lite reads it as
 * "is a body physically PRESENT" using real pose output. Both answer the same
 * physical question about the same conditions, so they must never diverge into
 * separate lists — a comparison across different scenarios is not a comparison.
 *
 * `expect` is the GROUND TRUTH, owned here. The operator never types it.
 */
export const PERSON_SCENARIOS = [
  { code: 'P01', id: 'frontal_seated', label: 'Frontal seated',
    instruction: 'Sit normally facing the camera in the standard study position.',
    purpose: 'Normal baseline presence.', expect: true },
  { code: 'P02', id: 'closer', label: 'Closer to the camera',
    instruction: 'Remain seated but move noticeably closer to the camera than '
      + 'the normal study position.',
    purpose: 'Near-distance robustness.', expect: true },
  { code: 'P03', id: 'farther', label: 'Farther from the camera',
    instruction: 'Remain visible but move farther from the camera, staying '
      + 'within a realistic study setup.',
    purpose: 'Far-distance robustness.', expect: true },
  { code: 'P04', id: 'upper_body_only', label: 'Upper body only',
    instruction: 'Use a realistic framing where primarily the upper body is '
      + 'visible.',
    purpose: 'Common laptop-webcam framing.', expect: true },
  { code: 'P05', id: 'extreme_yaw', label: 'Extreme yaw',
    instruction: 'Remain seated but turn your head strongly away, so the face '
      + 'becomes difficult to observe.',
    purpose: 'Presence despite poor face visibility.', expect: true, critical: true },
  { code: 'P06', id: 'back_facing', label: 'Back-facing',
    instruction: 'Remain physically in the study area while facing away from '
      + 'the camera.',
    purpose: 'Critical HACHIKO case: an unavailable face does not mean the '
      + 'user is absent.', expect: true, critical: true },
  { code: 'P07', id: 'face_covered', label: 'Face covered',
    instruction: 'Remain physically present while your face is substantially '
      + 'obscured. Do not leave the frame.',
    purpose: 'Physical presence under face occlusion.', expect: true, critical: true },
  { code: 'P08', id: 'reading_writing', label: 'Reading / writing',
    instruction: 'Read and write naturally while remaining in the study '
      + 'position.',
    purpose: 'Realistic studying posture.', expect: true, critical: true },
  { code: 'P09', id: 'empty_frame', label: 'Empty frame',
    instruction: 'No person is visible in the camera frame. Use a simple, '
      + 'low-clutter empty view if possible. Do NOT cover the camera lens.',
    purpose: 'Basic negative control.', expect: false, critical: true },
  { code: 'P10', id: 'empty_study_area', label: 'Empty study area',
    instruction: 'Leave the normal study position while the usual environment '
      + 'stays visible — desk, chair, books, bag. No person should be visible.',
    purpose: 'Harder negative control: do normal study-area objects cause a '
      + 'false human/presence detection?', expect: false, critical: true },
];

/**
 * PHONE matrix, H01–H10. Object detectors only — Pose Lite has no phone class
 * and must never be offered these.
 */
export const PHONE_SCENARIOS = [
  { code: 'H01', id: 'screen_portrait', label: 'Screen-facing, portrait',
    instruction: 'Hold the phone in portrait with the screen facing the camera.',
    purpose: 'Screen-side detection, portrait.', expect: true },
  { code: 'H02', id: 'screen_landscape', label: 'Screen-facing, landscape',
    instruction: 'Hold the phone in landscape with the screen facing the camera.',
    purpose: 'Screen-side detection, landscape.', expect: true },
  { code: 'H03', id: 'back_portrait', label: 'Back-facing, portrait',
    instruction: 'Hold the phone in portrait with the back of the device facing '
      + 'the camera.',
    purpose: 'Back-side detection, portrait.', expect: true },
  { code: 'H04', id: 'back_landscape', label: 'Back-facing, landscape',
    instruction: 'Hold the phone in landscape with the back of the device '
      + 'facing the camera.',
    purpose: 'Back-side detection, landscape.', expect: true },
  { code: 'H05', id: 'near_camera', label: 'Near the camera',
    instruction: 'Hold the phone clearly visible, relatively close to the camera.',
    purpose: 'Large-in-frame detection.', expect: true },
  { code: 'H06', id: 'study_distance', label: 'Normal study distance',
    instruction: 'Hold or use the phone at a realistic, normal study distance.',
    purpose: 'The critical realistic scenario.', expect: true, critical: true },
  { code: 'H07', id: 'on_desk', label: 'Resting on the desk',
    instruction: 'Let the phone lie on the study desk, within the camera view.',
    purpose: 'Presence only — do NOT infer distraction from this. The '
      + 'benchmark truth here is simply PHONE PRESENT.',
    expect: true, critical: true },
  { code: 'H08', id: 'partly_occluded', label: 'Partially occluded',
    instruction: 'Keep the phone genuinely present but partially covered by '
      + 'your hand or another realistic occlusion.',
    purpose: 'Detection under partial occlusion.', expect: true, critical: true },
  { code: 'H09', id: 'no_phone', label: 'No phone',
    instruction: 'A normal study scene with no phone present.',
    purpose: 'Basic phone negative control.', expect: false, critical: true },
  {
    // Named for what it tests, not for one object shape. Historical trials
    // recorded under `non_phone_rectangle` ran a vaguer protocol and are
    // deliberately NOT relabelled — see HISTORICAL_SCENARIO_IDS.
    code: 'H10', id: 'phone_lookalike_negative', label: 'Phone lookalike (hard negative)',
    instruction: 'PHONE ABSENT — all presented objects are non-phone hard '
      + 'negatives. Present the standard sequence: (1) remote control or small '
      + 'calculator-like rectangle, (2) tissue/card/flat rectangular packet, '
      + '(3) small rectangular book or package. Keep the same objects and order '
      + 'across every repetition, candidate and session. Never use a real phone.',
    purpose: 'Hard negative control derived from observed false positives.',
    expect: false, critical: true },
];

/**
 * Scenario ids that existed under an earlier, different protocol.
 *
 * They are recorded here so analysis can EXCLUDE or segregate them knowingly.
 * They are never silently mapped onto a current id: a historical
 * `non_phone_rectangle` trial did not run the standardised H10 object
 * sequence, so treating the two as the same measurement would fabricate
 * comparability that was never collected.
 */
export const HISTORICAL_SCENARIO_IDS = Object.freeze({
  non_phone_rectangle: {
    supersededBy: 'phone_lookalike_negative',
    reason: 'Ran before the standardised hard-negative object protocol; not '
          + 'comparable to H10 and must not be pooled with it.',
  },
});

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
