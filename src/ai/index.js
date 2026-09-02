/**
 * HACHIKO AI — Public API  (v0.2.1)
 * =================================
 * The single import surface for the AI core. Consumers import from here and
 * nothing else:
 *
 *     import { HachikoAI, FaceLandmarkerEngine, AIState } from './src/ai/index.js';
 *
 * Anything not exported here is internal and may change without notice.
 *
 * ── BOUNDARY GUARANTEES ───────────────────────────────────────────────────
 *
 * 1. FRAMEWORK-AGNOSTIC. No React, no Tauri, no bundler assumptions, no DOM
 *    outside FaceLandmarkerEngine (which takes a video element you supply).
 *    Plain ES modules that run in a browser or in Node.
 *
 * 2. THE CORE DOES NOT OWN THE CAMERA. Nothing here calls getUserMedia, and
 *    nothing starts or stops a stream. The host app owns camera permission and
 *    lifecycle, and supplies either a video element (FaceLandmarkerEngine) or a
 *    ready-made measurement (HachikoAI.processFrame). The debug harness in
 *    tools/debug owns a webcam only because it is a standalone tester.
 *
 * 3. THE CORE DOES NOT OWN STORAGE. HachikoAI emits structured telemetry via
 *    onFrame(); it never buffers, serialises, or writes anything. CSV/JSON and
 *    offline analysis live in tools/telemetry.
 *
 * 4. ASSET PATHS ARE INJECTABLE. Pass `assetPaths` to FaceLandmarkerEngine so
 *    the host decides where the model and WASM come from.
 *
 * ── MINIMAL USAGE ─────────────────────────────────────────────────────────
 *
 *   import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
 *   import { HachikoAI, FaceLandmarkerEngine, CONFIG } from './src/ai/index.js';
 *
 *   const ai = new HachikoAI(CONFIG);
 *   const engine = new FaceLandmarkerEngine(CONFIG, {
 *     FilesetResolver, FaceLandmarker,
 *     assetPaths: { modelAssetPath: myModelUrl, wasmPath: myWasmDir },
 *   });
 *   await engine.initialize();
 *
 *   ai.onFrame((frame) => render(frame.classification.state));
 *   ai.startCalibration(performance.now());
 *
 *   // The APP owns the camera and the loop.
 *   function tick() {
 *     const now = performance.now();
 *     const { measurement, inferenceMs, skipped } = engine.detect(videoEl, now);
 *     if (!skipped) ai.processFrame(measurement, now, inferenceMs);
 *     requestAnimationFrame(tick);
 *   }
 */

// ── Orchestrator ─────────────────────────────────────────────────────────
export { HachikoAI } from './HachikoAI.js';

// ── MediaPipe boundary (needs a video element; app owns the stream) ───────
export { FaceLandmarkerEngine } from './pipeline/FaceLandmarkerEngine.js';

// ── Configuration ────────────────────────────────────────────────────────
export { CONFIG, withOverrides } from './config.js';

// ── Enums & type contracts ───────────────────────────────────────────────
export {
  AIState,
  StateReason,
  CalibrationStatus,
  PoseInvalidReason,
  ScenarioTruth,
  EvidenceTier,
} from './types.js';

// ── Evidence model ───────────────────────────────────────────────────────
// EVIDENCE_SOURCES documents each signal's tier, so a consumer can render
// "strong vs support" without hardcoding the rules.
export { EvidenceEngine, EVIDENCE_SOURCES } from './pipeline/EvidenceEngine.js';

// ── Pipeline stages ──────────────────────────────────────────────────────
// Exported for targeted testing and advanced composition. Most consumers only
// need HachikoAI, which wires these together.
export { CalibrationEngine } from './pipeline/CalibrationEngine.js';
export { FeatureSmoother } from './pipeline/FeatureSmoother.js';
export { TemporalTracker, PersistenceTimer, FaceMissingTracker } from './pipeline/TemporalTracker.js';
export { StateEngine } from './pipeline/StateEngine.js';
export { HeadPoseExtractor } from './pipeline/HeadPoseExtractor.js';
export { EyeFeatureExtractor } from './pipeline/EyeFeatureExtractor.js';

// ── Pure math ────────────────────────────────────────────────────────────
// Deterministic, dependency-free helpers. Useful for offline replay analysis.
export {
  normalizeAngleDeg,
  median,
  percentile,
  robustSpread,
  ema,
  eyeAspectRatio,
  rotationMatrixToEuler,
  rotationFromMatrix,
  detectMatrixLayout,
  isValidRotationMatrix,
  isFiniteNumber,
} from './core/math.js';

export { HachikoAI as default } from './HachikoAI.js';
