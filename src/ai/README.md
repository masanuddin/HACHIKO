# HACHIKO AI Core v0.2.1

Browser-side measurement and state engine:
**webcam → MediaPipe Face Landmarker → features → calibration → temporal → 3 states**

## Quick start

```bash
npm install
npm run assets      # copy WASM + model into public/assets/
npm run dev         # debug harness at http://localhost:5173
npm test            # 120 unit tests, no webcam needed
npm run smoke       # debug-harness wiring smoke test
npm run verify      # both
```

## Module map

| Module | Responsibility | Pure? |
|---|---|---|
| [index.js](./index.js) | **Public API — import from here only.** | — |
| [config.js](./config.js) | **Every** threshold and tunable. Single source of truth. | — |
| [types.js](./types.js) | `AIState`, `StateReason`, `CalibrationStatus`, typedefs | — |
| [core/math.js](./core/math.js) | angles, median, EMA, EAR, rotation→Euler | ✅ |
| [pipeline/FaceLandmarkerEngine.js](./pipeline/FaceLandmarkerEngine.js) | **Only** module touching MediaPipe/DOM/camera | ❌ |
| [pipeline/HeadPoseExtractor.js](./pipeline/HeadPoseExtractor.js) | 4×4 matrix → yaw/pitch/roll + validity | ✅ |
| [pipeline/EyeFeatureExtractor.js](./pipeline/EyeFeatureExtractor.js) | landmarks → EAR left/right/mean | ✅ |
| [pipeline/CalibrationEngine.js](./pipeline/CalibrationEngine.js) | 5 s median baseline → deltas / ratio | ✅ |
| [pipeline/FeatureSmoother.js](./pipeline/FeatureSmoother.js) | frame-rate-compensated EMA | ✅ |
| [pipeline/TemporalTracker.js](./pipeline/TemporalTracker.js) | persistence timers, dropout tolerance | ✅ |
| [pipeline/EvidenceEngine.js](./pipeline/EvidenceEngine.js) | **v0.2** tiered evidence: STRONG vs SUPPORT | ✅ |
| [pipeline/StateEngine.js](./pipeline/StateEngine.js) | evidence → FOKUS/TERALIH/TIDAK_HADIR | ✅ |
| [HachikoAI.js](./HachikoAI.js) | orchestrator; `processFrame()` is I/O-free | ✅ |

Tools live **outside** the core and consume the public API like any app would:

| Tool | Responsibility |
|---|---|
| [../../tools/telemetry/TelemetryLogger.js](../../tools/telemetry/TelemetryLogger.js) | ring buffer, CSV/JSON, analysis, privacy guard |
| [../../tools/debug/DebugHarness.js](../../tools/debug/DebugHarness.js) | standalone webcam tester — **not product UI** |

Everything marked ✅ runs in plain Node, which is why the whole state machine is
testable without a camera.

## Usage

```js
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { HachikoAI, FaceLandmarkerEngine, CONFIG } from './src/ai/index.js';

const ai = new HachikoAI(CONFIG);
const engine = new FaceLandmarkerEngine(CONFIG, {
  FilesetResolver, FaceLandmarker,
  assetPaths: { modelAssetPath: myModelUrl, wasmPath: myWasmDir }, // injectable
});
await engine.initialize();

ai.onFrame((frame) => render(frame.classification.state));
ai.startCalibration(performance.now());   // 5 s, student looks at the screen

// THE APP owns the camera and the loop. The core never calls getUserMedia.
function loop() {
  const now = performance.now();
  const { measurement, inferenceMs, skipped } = engine.detect(videoEl, now);
  if (!skipped) ai.processFrame(measurement, now, inferenceMs);
  requestAnimationFrame(loop);
}
```

Want telemetry? Attach a tool — the core stays unaware of it:

```js
import { TelemetryLogger } from './tools/telemetry/TelemetryLogger.js';
const logger = new TelemetryLogger(CONFIG);
logger.attach(ai);              // subscribes to onFrame
logger.toCSV(); logger.analyze();
```

## Design commitments

**FOKUS is operational, not cognitive.** It means "present, and no distraction
rule fired". It is *not* a claim that the student is concentrating. Nothing here
can see attention.

**Conservative by default.** TERALIH and TIDAK_HADIR must be earned by sustained
evidence. A false "distracted" shown to a 12–15 year old is more harmful than a
missed one: it teaches them the tool is wrong and they stop trusting it.

**Tiered evidence, not a flat OR (v0.2).** Features are not equivalent triggers:

| Tier | Sources | May trigger TERALIH alone? |
|---|---|---|
| STRONG | yaw, **upward** pitch, long eye closure | yes, after persistence |
| SUPPORT | **downward** pitch, roll | **never**, at any magnitude or duration |

Downward pitch and roll are what reading, writing and ordinary posture look
like. They are measured, logged and exposed in telemetry, and they can
corroborate a strong source, but they can never cause a state change. The
guarantee is structural: `StateReason` has no `PITCH_DOWN` or `ROLL` member, and
`EvidenceEngine.decide()` never reads support flags.

**Calibrated, not absolute.** Thresholds are relative to a per-session median
baseline. The Python harness compared against absolute constants; its own log
shows median EAR 0.20 against a 0.21 threshold, so "eyes closed" fired on roughly
half of all frames.

**Invalid is never zero.** A failed pose returns `null` + `poseValid: false` +
a reason. The Python harness returned `0.0, 0.0`, making failure
indistinguishable from looking straight ahead.

**Raw ≠ derived.** Telemetry nests raw measurement and derived state separately
so the state can never be mistaken for a ground-truth label.

**No imagery, ever.** Only derived numbers are retained, enforced at runtime by
`TelemetryLogger`, which throws on any binary or image-shaped field.

**The core owns neither the camera nor storage (v0.2.1).** It never calls
`getUserMedia`, never starts or stops a stream, and never buffers or writes
telemetry — it only emits frames via `onFrame()`. Asset paths are injectable.
Enforced by [tests/boundary.test.js](../../tests/boundary.test.js), which scans
`src/ai` for framework imports, DOM access, and camera APIs.

## Tuning

All thresholds live in [config.js](./config.js) and are marked
`PROVISIONAL — must be revalidated after pilot`. Nothing is hardcoded elsewhere.

Evidence sources are individually switchable:

```js
enableYawEvidence: true,        // STRONG
enablePitchUpEvidence: true,    // STRONG  (upward only)
enableEyeClosureEvidence: true, // STRONG
enableDownPitchSupport: true,   // SUPPORT (telemetry only)
enableRollSupport: true,        // SUPPORT (telemetry only)
```

There is deliberately **no switch that promotes a support source to strong** —
that is a rule change made in `EvidenceEngine`, not a boolean, so it cannot
happen by accident. A test asserts no such switch exists.

Replaying the historical Python log through this engine flags reading
(`baca_buku`, 31.1% TERALIH) *more* often than phone use (`pegang_hp`, 24.8%) —
head pose and EAR cannot separate them. That gap is what the v0.3 phone
detector is for.

## Roadmap

- **v0.1** — face → pose/eye → calibration → temporal → 3 states ✅
- **v0.2** — tiered evidence fusion, roll, scenario ground truth, analysis pack
  (live hardware gates pending)
- **v0.2.1** — this: structure/API cleanup. Public API at `index.js`; tools
  moved out of the core; no behaviour change.
- **v0.3** — phone detector → `phone_present` events (must not directly set state)
- **v0.4** — structured event API + confidence for the app layer
- **v0.5** — Web Worker, low-end laptops, webcam variation, error recovery
- **v1.0** — AI freeze
