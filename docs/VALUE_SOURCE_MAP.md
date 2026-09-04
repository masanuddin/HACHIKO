# HACHIKO — Authoritative value-source map

Every number shown by the two engineering pages, with the one place it comes
from, how often it updates, and when it is allowed to be absent.

This document exists because of a real defect class, not as ceremony. An
earlier build showed `Head-pose signal VALID` beside a dash for every angle, and
`State —` in the header while the body showed `FOKUS`. Nothing was wrong with
the AI: the UI simply had **two writers with a gap between them**, and the cells
in the gap had no writer at all. The rule below is what prevents a repeat.

All of it flows through **one canonical view model**:
`tools/debug/debugViewModel.js`. `DebugHarness` is the single `onFrame`
subscriber; it builds the model once per frame, renders the centre panel from
it, and hands the same object to the page for the Signal Inspector and Runtime.

> **One field, one authoritative source, one writer.**
> If a value appears in two places, both must read the same frame object.
> A UI component may never recompute a value another layer already derived.

---

## 1. Debug Harness

`DebugHarness` is the **only** `ai.onFrame` subscriber. Per frame it calls
`buildViewModel()` once, renders the centre panel, then invokes
`harness.onViewModel(vm)` so the page renders the Signal Inspector and Runtime
from the *same object*.

The page must never attach its own `ai.onFrame` listener. `HachikoAI`
deliberately isolates a throwing listener so one consumer cannot kill inference
— which meant an error in a second subscriber blanked its whole panel in
silence. `tests/viewmodel.test.js` V12 enforces the single-subscriber rule.

| UI field | Authoritative source | Cadence | Valid when |
|---|---|---|---|
| Camera state | `harness.running` + stream state | on start/stop | — |
| `hCam` | same as above | on start/stop | — |
| `state` (AI Result) | `frame.classification.state` | every frame | always |
| `hState` (header) | **same** `frame.classification.state` | every frame | always |
| `reason` | `frame.classification.primaryReason` | every frame | always |
| `stateDur` | `frame.classification.stateDurationMs` | every frame | always |
| `stateValid` | `frame.validity.stateSignalValid` | every frame | always |
| `calStatus` | `ai.getCalibrationSnapshot().status` | every frame | always |
| `hCal` (header) | **same** snapshot | every frame | always |
| `calSamples` | `snapshot.baseline.sampleCount` | every frame | baseline exists |
| `calDetail` | `snapshot.baseline` | every frame | baseline exists |
| `face` | `frame.measurement.facePresent` | every frame | always |
| `poseValid` | `frame.measurement.poseValid` | every frame | always |
| `yawRaw` / `pitchRaw` / `rollRaw` | `frame.measurement.{yaw,pitch,roll}Raw` (HeadPoseExtractor) | every frame | `facePresent && poseValid` |
| `yawDelta` / `pitchDelta` / `rollDelta` | `frame.calibrated.*Delta` (raw − baseline) | every frame | above **and** calibration `VALID` |
| `yawSm` / `pitchSm` / `rollSm` | `frame.temporal.*Smoothed` (FeatureSmoother) | every frame | `facePresent && poseValid` |
| `earL` / `earR` / `earMean` | `frame.measurement.ear*` | every frame | `facePresent` |
| `earRel` | `frame.calibrated.earRelative` | every frame | `facePresent` and calibration `VALID` |
| `earSm` | `frame.temporal.earSmoothed` | every frame | `facePresent` |
| `eyeElig` / `eyeEligCell` | `frame.evidence.eyeEligible` | every frame | always |
| `eyeReason` | `frame.evidence.eyeIneligibleReason` | every frame | always (`None` when eligible) |
| `evYaw` … `evRoll` | `frame.evidence.active.*` | every frame | always |
| `*Pers` cells | `frame.evidence.accumulated.*` vs `CONFIG.state.*` | every frame | rule evaluable |
| `*Bar` widths | **same** `accumulated` values | every frame | rule evaluable |
| `fps` | `frame.performance.fps` | every frame | camera running |
| `inference` | `frame.performance.inferenceMs` | every frame | camera running |
| `infP50` / `infP95` | `harness.latency` rolling window (≤240) | every frame | ≥20 samples collected |
| `hPerf` (header) | **same** `frame.performance` | every frame | camera running |
| `delegate` | `engine.activeDelegate` | on model load | camera running |
| `rng*Min/Max` | `harness.extremes` | every frame | ≥1 finite sample |
| `rtNonFinite` / `rtWrap` | `harness.extremes` counters | every frame | always |
| `missing` | `frame.temporal.faceMissingMs` | every frame | shown only while > 0 |
| `dgGrace` | `frame.classification.holding` | every frame | shown only while holding |

### Placeholder semantics (§4)

A dash is never a substitute for a reason. Each absent value states *why*:

| Rendered | Meaning |
|---|---|
| `Waiting for camera` | no frame has arrived yet |
| `No face` | no face in frame, so the measurement cannot exist |
| `Signal invalid` | face present but pose extraction failed |
| `Requires calibration` | measurable, but needs a baseline to be relative |
| `Collecting…` | valid but not yet enough samples (percentiles) |
| `Unavailable` | *should* exist and does not — a real defect worth chasing |
| `None` | no rejection / nothing to report |
| `N/A` | genuinely not applicable to this model or state |
| `PENDING BAKE-OFF` | model not selected yet |

`Unavailable` is deliberately distinct: it is the only one that means something
is wrong.

---

## 2. Perception Model Benchmark

`BenchmarkRunner.observe()` is the single source of live model output.
`buildModelSummaries()` is the single source of comparative metrics — the page
never recomputes recall, specificity or discriminability.

| UI field | Authoritative source | Cadence | Valid when |
|---|---|---|---|
| `scPerson` / `scPhone` | `obs.{person,phone}MaxScore` | inference tick | candidate loaded |
| `pkPerson` / `pkPhone` | `peak` rolling live buffer (ephemeral) | inference tick | candidate loaded |
| `topDet` | `obs.detections` (sorted) | inference tick | object family only |
| `vsCompName` / `vsCompScore` | `obs.topOther[0]` | inference tick | object family only |
| overlay boxes | `obs.detections[].boundingBox` | inference tick | object family only |
| `poDetected` / `poLandmarks` / `poVisible` / `poRatio` | `obs.{bodyDetected,landmarkCount,visibleLandmarks,presenceScore}` | inference tick | pose family only |
| `hlLat` (p50/p95) | `lat` rolling window (≤120) | inference tick | ≥1 sample |
| `hlFps` | frame-delta EMA | inference tick | ≥2 frames |
| `hlRaw` | `obs.rawCount` | inference tick | candidate loaded |
| trial `peakScore` | `BenchmarkRunner.peak(trial.samples)` | trial completion | bounded window only |
| `completion` bars | `runner.progressFor()` | save/delete | — |
| comparison row metrics | `buildModelSummaries()` | save/delete | task data exists |
| `finalRank` | `buildModelSummaries()` | save/delete | candidate `COMPLETE` |
| ranking block | same | save/delete | **all** assigned candidates complete |
| recommendation | `buildRecommendation()` | save/delete | strategy ≠ `INCOMPLETE` |

### The live/committed boundary

The inspector and the benchmark record read the **same** observation object but
have different lifetimes:

- **Live** (`peak`, `trend`, `lat`) — ephemeral, reset on model change, never
  exported, never part of a trial.
- **Committed** (`runner.trials`) — only samples `TrialController.offerSample()`
  accepted, i.e. inside `[recordingStartedAt, recordingEndedAt]`.

`tests/inspector.test.js` I1/I2/I8 hold this boundary; `tests/binding.test.js`
holds the debug source map.
