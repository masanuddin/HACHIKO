/**
 * Unit tests — end-to-end state engine behaviour.
 *
 * Drives the FULL pipeline (calibration -> smoothing -> temporal -> state)
 * through HachikoAI with synthetic measurements and a virtual clock. No webcam,
 * no DOM, fully deterministic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HachikoAI, withOverrides, CONFIG, AIState, StateReason, PoseInvalidReason,
} from '../src/ai/index.js';
import { TelemetryLogger } from '../tools/telemetry/TelemetryLogger.js';

const FRAME_MS = 1000 / 30;

function measurement(over = {}) {
  return {
    facePresent: true, poseValid: true, poseInvalidReason: PoseInvalidReason.NONE,
    yawRaw: 0, pitchRaw: 0, rollRaw: 0,
    earLeft: 0.30, earRight: 0.30, earMean: 0.30,
    ...over,
  };
}

/** Drive the AI for `durationMs`, calling build(t) per frame. Returns frames. */
function run(ai, startMs, durationMs, build) {
  const frames = [];
  for (let t = startMs; t < startMs + durationMs; t += FRAME_MS) {
    frames.push(ai.processFrame(build(t), t));
  }
  return frames;
}

/** Fresh AI with a completed, valid calibration at neutral pose. */
function calibratedAI(config = CONFIG) {
  const ai = new HachikoAI(config);
  ai.startCalibration(0);
  const dur = config.calibration.CALIBRATION_DURATION_MS;
  run(ai, 0, dur + FRAME_MS, () => measurement());
  assert.equal(ai.calibration.isValid(), true, 'calibration should succeed');
  return { ai, t0: dur + FRAME_MS };
}

// ── Baseline behaviour ──────────────────────────────────────────────────
test('a calibrated, attentive student reports FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  const frames = run(ai, t0, 3000, () => measurement());
  const last = frames[frames.length - 1];
  assert.equal(last.classification.state, AIState.FOKUS);
  assert.equal(last.classification.reason, StateReason.NONE);
});

test('engine does not classify while calibration is still collecting', () => {
  const ai = new HachikoAI(CONFIG);
  ai.startCalibration(0);
  // Even looking hard away during calibration must not produce TERALIH.
  const frames = run(ai, 0, 4000, () => measurement({ yawRaw: 80 }));
  for (const f of frames) {
    assert.equal(f.classification.state, AIState.FOKUS);
    assert.equal(f.classification.calibrating, true);
  }
});

// ── TIDAK_HADIR ─────────────────────────────────────────────────────────
test('ONE dropped frame does NOT become TIDAK_HADIR', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const f = ai.processFrame(
    measurement({ facePresent: false, poseValid: false, yawRaw: null, pitchRaw: null, rollRaw: null, earLeft: null, earRight: null, earMean: null }),
    t0 + 1000
  );
  assert.equal(f.classification.state, AIState.FOKUS,
    'a single missing frame must never flip the state');
});

test('brief occlusion (hand over face, ~1 s) does NOT become TIDAK_HADIR', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 1000, () =>
    measurement({ facePresent: false, poseValid: false, earMean: null }));
  const last = frames[frames.length - 1];
  assert.notEqual(last.classification.state, AIState.TIDAK_HADIR,
    '1 s < FACE_MISSING_ENTER_MS (2 s), must not trigger');
});

test('sustained absence becomes TIDAK_HADIR with reason ABSENCE', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 4000, () =>
    measurement({ facePresent: false, poseValid: false, earMean: null }));
  const last = frames[frames.length - 1];
  assert.equal(last.classification.state, AIState.TIDAK_HADIR);
  assert.equal(last.classification.primaryReason, StateReason.ABSENCE);
});

test('returning to camera recovers to FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  run(ai, t0 + 1000, 4000, () => measurement({ facePresent: false, poseValid: false, earMean: null }));
  assert.equal(ai.stateEngine.state, AIState.TIDAK_HADIR);

  const frames = run(ai, t0 + 5000, 3000, () => measurement());
  const last = frames[frames.length - 1];
  assert.equal(last.classification.state, AIState.FOKUS);
});

// ── TERALIH via yaw ─────────────────────────────────────────────────────
test('a transient glance away does NOT become TERALIH', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  // 800 ms turn — well under YAW_PERSIST_MS (1500 ms).
  const frames = run(ai, t0 + 1000, 800, () => measurement({ yawRaw: 45 }));
  const last = frames[frames.length - 1];
  assert.equal(last.classification.state, AIState.FOKUS,
    'brief glances are normal and must not be punished');
});

test('a sustained head turn becomes TERALIH with reason YAW', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 5000, () => measurement({ yawRaw: 45 }));
  const last = frames[frames.length - 1];
  assert.equal(last.classification.state, AIState.TERALIH);
  assert.equal(last.classification.reason, StateReason.YAW);
});

test('yaw evidence works symmetrically for left and right turns', () => {
  for (const yaw of [45, -45]) {
    const { ai, t0 } = calibratedAI();
    run(ai, t0, 1000, () => measurement());
    const frames = run(ai, t0 + 1000, 5000, () => measurement({ yawRaw: yaw }));
    assert.equal(frames[frames.length - 1].classification.state, AIState.TERALIH,
      `yaw ${yaw} should trigger`);
  }
});

test('returning to centre recovers from TERALIH to FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  run(ai, t0 + 1000, 5000, () => measurement({ yawRaw: 45 }));
  assert.equal(ai.stateEngine.state, AIState.TERALIH);

  const frames = run(ai, t0 + 6000, 3000, () => measurement());
  const last = frames[frames.length - 1];
  assert.equal(last.classification.state, AIState.FOKUS);
  assert.equal(last.classification.reason, StateReason.NONE);
});

test('yaw just under threshold never triggers', () => {
  const { ai, t0 } = calibratedAI();
  // 20 deg < YAW_DELTA_THRESHOLD (25), held for a long time.
  const frames = run(ai, t0, 8000, () => measurement({ yawRaw: 20 }));
  assert.equal(frames[frames.length - 1].classification.state, AIState.FOKUS);
});

// ── Calibration makes thresholds personal ───────────────────────────────
test('thresholds are relative to baseline, not absolute', () => {
  // Student sits with the camera off to one side: neutral yaw is 30 deg.
  const ai = new HachikoAI(CONFIG);
  ai.startCalibration(0);
  run(ai, 0, CONFIG.calibration.CALIBRATION_DURATION_MS + FRAME_MS,
    () => measurement({ yawRaw: 30 }));
  assert.equal(ai.calibration.isValid(), true);

  const t0 = CONFIG.calibration.CALIBRATION_DURATION_MS + FRAME_MS;
  // Still at 30 deg absolute = 0 deg relative. Absolute logic (the Python
  // harness's |yaw| > 30) would have called this distracted forever.
  const frames = run(ai, t0, 6000, () => measurement({ yawRaw: 30 }));
  assert.equal(frames[frames.length - 1].classification.state, AIState.FOKUS);
});

// ── Eye closure ─────────────────────────────────────────────────────────
test('a normal blink does NOT become TERALIH', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  // ~150 ms blink.
  const frames = run(ai, t0 + 1000, 150, () =>
    measurement({ earLeft: 0.05, earRight: 0.05, earMean: 0.05 }));
  assert.equal(frames[frames.length - 1].classification.state, AIState.FOKUS);
});

test('sustained eye closure becomes TERALIH with reason EYE_CLOSURE', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 5000, () =>
    measurement({ earLeft: 0.10, earRight: 0.10, earMean: 0.10 }));
  const last = frames[frames.length - 1];
  assert.equal(last.classification.state, AIState.TERALIH);
  assert.equal(last.classification.reason, StateReason.EYE_CLOSURE);
});

// ── Reason traceability ─────────────────────────────────────────────────
test('simultaneous strong evidence reports MULTIPLE', () => {
  // v0.2 live-gate fix: yaw + eye closure is no longer a reachable pairing,
  // because a yaw large enough to trigger also makes EAR ineligible. The
  // reachable pair is yaw + upward pitch.
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 8000, () =>
    measurement({ yawRaw: 45, pitchRaw: 40 }));
  const last = frames[frames.length - 1];
  assert.equal(last.classification.state, AIState.TERALIH);
  assert.equal(last.classification.primaryReason, StateReason.MULTIPLE);
});

// ── Feature switches ────────────────────────────────────────────────────
test('downward pitch is support-only: reading a book stays FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  // Head down 40 deg for 6 s — a student reading.
  const frames = run(ai, t0, 6000, () => measurement({ pitchRaw: -40 }));
  assert.equal(frames[frames.length - 1].classification.state, AIState.FOKUS,
    'default config must not punish reading');
});

test('v0.2: UPWARD pitch is strong evidence and triggers TERALIH', () => {
  // Replaces the v0.1 non-directional pitch test. Upward pitch has no
  // study-compatible explanation at a desk, so it is a strong source.
  const { ai, t0 } = calibratedAI();
  const frames = run(ai, t0, 6000, () => measurement({ pitchRaw: 40 }));
  const last = frames[frames.length - 1];
  assert.equal(last.classification.state, AIState.TERALIH);
  assert.equal(last.classification.primaryReason, StateReason.PITCH_UP);
});

test('eye-closure evidence can be disabled via config alone', () => {
  const cfg = withOverrides({ state: { enableEyeClosureEvidence: false } });
  const { ai, t0 } = calibratedAI(cfg);
  const frames = run(ai, t0, 6000, () =>
    measurement({ earLeft: 0.05, earRight: 0.05, earMean: 0.05 }));
  assert.equal(frames[frames.length - 1].classification.state, AIState.FOKUS);
});

// ── Flicker / hysteresis ────────────────────────────────────────────────
test('signal hovering at the threshold does not flicker between states', () => {
  const { ai, t0 } = calibratedAI();
  let flips = 0;
  let prev = null;
  // Oscillate either side of the 25 deg threshold every frame for 10 s.
  const frames = run(ai, t0, 10000, (t) => {
    const n = Math.round((t - t0) / FRAME_MS);
    return measurement({ yawRaw: n % 2 === 0 ? 24 : 26 });
  });
  for (const f of frames) {
    if (prev !== null && f.classification.state !== prev) flips++;
    prev = f.classification.state;
  }
  assert.ok(flips <= 2, `expected a stable outcome, saw ${flips} transitions`);
});

test('invalid pose holds the previous state instead of forcing a transition', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  // Face visible but pose unsolvable for 500 ms (within the grace period).
  const frames = run(ai, t0 + 1000, 500, () => measurement({
    poseValid: false, poseInvalidReason: PoseInvalidReason.DEGENERATE_MATRIX,
    yawRaw: null, pitchRaw: null, rollRaw: null,
  }));
  const last = frames[frames.length - 1];
  assert.equal(last.classification.state, AIState.FOKUS);
  assert.equal(last.validity.signalValid, false, 'invalidity must be reported...');
  assert.equal(last.measurement.yawRaw, null, '...and angles stay null, never 0');
});

// ── Telemetry contract ──────────────────────────────────────────────────
test('telemetry separates raw measurement from derived state', () => {
  const { ai, t0 } = calibratedAI();
  const [frame] = run(ai, t0, FRAME_MS * 2, () => measurement({ yawRaw: 12 }));
  assert.ok('measurement' in frame && 'classification' in frame);
  assert.ok('yawRaw' in frame.measurement);
  assert.ok(!('state' in frame.measurement), 'state must not leak into measurement');
  assert.ok('state' in frame.classification);
  assert.ok('yawDelta' in frame.calibrated);
  assert.ok('yawSmoothed' in frame.temporal);
  assert.ok('inferenceMs' in frame.performance && 'fps' in frame.performance);
});

test('telemetry CSV marks derived columns with a d_ prefix', () => {
  const { ai, t0 } = calibratedAI();
  const logger = new TelemetryLogger(CONFIG);
  logger.attach(ai);
  run(ai, t0, 500, () => measurement());
  const csv = logger.toCSV();
  const header = csv.split('\n')[0];
  assert.ok(header.includes('m_yawRaw'), 'raw measurement prefixed m_');
  assert.ok(header.includes('d_state'), 'derived state prefixed d_');
  assert.ok(header.includes('d_primaryReason'));
  assert.ok(header.includes('g_manualScenarioTruth'), 'ground truth prefixed g_');
  assert.ok(header.includes('e_yawStrong'), 'evidence prefixed e_');
  assert.ok(!header.includes(',state,'), 'no bare "status"-style column');
});

test('telemetry refuses to store image data (privacy invariant)', () => {
  const logger = new TelemetryLogger(CONFIG);
  assert.throws(
    () => logger.record({ timestampMs: 0, measurement: {}, calibrated: {}, temporal: {}, classification: {}, performance: {}, frame: new Uint8Array(4) }),
    /forbidden key|refusing to store/
  );
});

test('reset clears calibration and state, and starts a new session', () => {
  const { ai, t0 } = calibratedAI();
  const before = ai.sessionId;
  run(ai, t0, 5000, () => measurement({ yawRaw: 45 }));
  assert.equal(ai.stateEngine.state, AIState.TERALIH);
  ai.reset();
  assert.equal(ai.calibration.isValid(), false);
  assert.equal(ai.stateEngine.state, AIState.FOKUS);
  assert.equal(ai.sessionId, before + 1, 'consumers can detect the boundary');
});

test('v0.2.1: the AI core does not own telemetry storage', () => {
  const { ai } = calibratedAI();
  assert.equal(typeof ai.getTelemetry, 'undefined',
    'storage moved to tools/telemetry');
  assert.equal(typeof ai.onFrame, 'function', 'emission is the only channel');
});

// ── Uncalibrated safety ─────────────────────────────────────────────────
test('without calibration the engine never claims TERALIH', () => {
  const ai = new HachikoAI(CONFIG);   // never calibrated
  const frames = run(ai, 0, 8000, () => measurement({ yawRaw: 80, earMean: 0.05 }));
  for (const f of frames) {
    assert.notEqual(f.classification.state, AIState.TERALIH,
      'no personal baseline => no distraction judgement');
  }
});

test('without calibration TIDAK_HADIR still works (presence needs no baseline)', () => {
  const ai = new HachikoAI(CONFIG);
  run(ai, 0, 1000, () => measurement());
  const frames = run(ai, 1000, 4000, () =>
    measurement({ facePresent: false, poseValid: false, earMean: null }));
  assert.equal(frames[frames.length - 1].classification.state, AIState.TIDAK_HADIR);
});
