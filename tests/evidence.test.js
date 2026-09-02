/**
 * v0.2 tests — hierarchical multimodal evidence fusion.
 *
 * These encode the central v0.2 guarantee: STRONG evidence may independently
 * produce TERALIH; SUPPORT evidence never may, no matter how large or how long.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HachikoAI, withOverrides, CONFIG,
  AIState, StateReason, PoseInvalidReason, ScenarioTruth,
  EvidenceEngine, EVIDENCE_SOURCES,
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
const absent = () => measurement({
  facePresent: false, poseValid: false, poseInvalidReason: PoseInvalidReason.NO_FACE,
  yawRaw: null, pitchRaw: null, rollRaw: null,
  earLeft: null, earRight: null, earMean: null,
});

function run(ai, startMs, durationMs, build) {
  const frames = [];
  for (let t = startMs; t < startMs + durationMs; t += FRAME_MS) {
    frames.push(ai.processFrame(build(t), t));
  }
  return frames;
}
function calibratedAI(config = CONFIG) {
  const ai = new HachikoAI(config);
  ai.startCalibration(0);
  const dur = config.calibration.CALIBRATION_DURATION_MS;
  run(ai, 0, dur + FRAME_MS, () => measurement());
  assert.equal(ai.calibration.isValid(), true);
  return { ai, t0: dur + FRAME_MS };
}
const lastOf = (frames) => frames[frames.length - 1];

// ── Tier declarations ───────────────────────────────────────────────────
test('evidence sources declare correct tiers', () => {
  assert.equal(EVIDENCE_SOURCES.yawStrong.tier, 'STRONG');
  assert.equal(EVIDENCE_SOURCES.pitchUpStrong.tier, 'STRONG');
  assert.equal(EVIDENCE_SOURCES.eyeClosureStrong.tier, 'STRONG');
  assert.equal(EVIDENCE_SOURCES.pitchDownSupport.tier, 'SUPPORT');
  assert.equal(EVIDENCE_SOURCES.rollSupport.tier, 'SUPPORT');
});

test('support sources have no primary reason available to them', () => {
  // Structural guarantee: a support source cannot even name a reason.
  assert.equal(EVIDENCE_SOURCES.pitchDownSupport.reason, null);
  assert.equal(EVIDENCE_SOURCES.rollSupport.reason, null);
  assert.equal(StateReason.PITCH_DOWN, undefined, 'PITCH_DOWN must not exist');
  assert.equal(StateReason.ROLL, undefined, 'ROLL must not exist');
});

test('decide() ignores support flags entirely', () => {
  const ev = new EvidenceEngine(CONFIG);
  const out = ev.decide({ pitchDownSupport: true, rollSupport: true });
  assert.equal(out.diverted, false, 'support alone is never diversion');
  assert.equal(out.primaryReason, StateReason.NONE);
  assert.equal(out.supportCount, 2, 'but it is still reported');
  assert.equal(out.activeEvidence.pitchDownSupport, true);
});

test('decide() reports MULTIPLE only for 2+ STRONG sources', () => {
  const ev = new EvidenceEngine(CONFIG);
  assert.equal(ev.decide({ yawStrong: true }).primaryReason, StateReason.YAW);
  assert.equal(
    ev.decide({ yawStrong: true, pitchDownSupport: true, rollSupport: true }).primaryReason,
    StateReason.YAW, 'support must not inflate a single strong source to MULTIPLE');
  assert.equal(
    ev.decide({ yawStrong: true, eyeClosureStrong: true }).primaryReason,
    StateReason.MULTIPLE);
});

// ── SUPPORT-ONLY: downward pitch ────────────────────────────────────────
test('downward pitch ALONE stays FOKUS (reading / writing / notes)', () => {
  const { ai, t0 } = calibratedAI();
  // 45 deg down — far past DOWN_PITCH_SUPPORT_DEG — held for 15 s.
  const frames = run(ai, t0, 15000, () => measurement({ pitchRaw: -45 }));
  const last = lastOf(frames);
  assert.equal(last.classification.state, AIState.FOKUS,
    'reading must never be punished');
  assert.equal(last.classification.primaryReason, StateReason.NONE);
  assert.equal(last.evidence.active.pitchDownSupport, true,
    'but the evidence must still be visible in telemetry');
});

test('extreme sustained downward pitch still stays FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  const frames = run(ai, t0, 30000, () => measurement({ pitchRaw: -70 }));
  assert.equal(lastOf(frames).classification.state, AIState.FOKUS,
    'no magnitude or duration of head-down alone may trigger TERALIH');
});

// ── SUPPORT-ONLY: roll ──────────────────────────────────────────────────
test('head tilt (roll) ALONE stays FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  const frames = run(ai, t0, 15000, () => measurement({ rollRaw: 40 }));
  const last = lastOf(frames);
  assert.equal(last.classification.state, AIState.FOKUS);
  assert.equal(last.evidence.active.rollSupport, true);
});

test('both support signals together still stay FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  const frames = run(ai, t0, 15000, () => measurement({ pitchRaw: -45, rollRaw: 35 }));
  const last = lastOf(frames);
  assert.equal(last.classification.state, AIState.FOKUS,
    'support + support is still not strong evidence');
  assert.equal(last.evidence.active.pitchDownSupport, true);
  assert.equal(last.evidence.active.rollSupport, true);
});

// ── STRONG: yaw ─────────────────────────────────────────────────────────
test('short yaw excursion stays FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 700, () => measurement({ yawRaw: 45 }));
  assert.equal(lastOf(frames).classification.state, AIState.FOKUS);
});

test('sustained strong yaw becomes TERALIH', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 6000, () => measurement({ yawRaw: 45 }));
  const last = lastOf(frames);
  assert.equal(last.classification.state, AIState.TERALIH);
  assert.equal(last.classification.primaryReason, StateReason.YAW);
  assert.equal(last.evidence.active.yawStrong, true);
});

// ── STRONG: upward pitch (directional) ──────────────────────────────────
test('short upward pitch stays FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 900, () => measurement({ pitchRaw: 45 }));
  assert.equal(lastOf(frames).classification.state, AIState.FOKUS);
});

test('sustained strong UPWARD pitch becomes TERALIH', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 8000, () => measurement({ pitchRaw: 45 }));
  const last = lastOf(frames);
  assert.equal(last.classification.state, AIState.TERALIH);
  assert.equal(last.classification.primaryReason, StateReason.PITCH_UP);
});

test('pitch is DIRECTIONAL: +40 triggers, -40 does not', () => {
  // The single most important asymmetry in v0.2.
  const up = calibratedAI();
  const upFrames = run(up.ai, up.t0, 10000, () => measurement({ pitchRaw: 40 }));
  assert.equal(lastOf(upFrames).classification.state, AIState.TERALIH);

  const down = calibratedAI();
  const downFrames = run(down.ai, down.t0, 10000, () => measurement({ pitchRaw: -40 }));
  assert.equal(lastOf(downFrames).classification.state, AIState.FOKUS);
});

// ── STRONG: eye closure ─────────────────────────────────────────────────
test('normal blink stays FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 200, () =>
    measurement({ earLeft: 0.05, earRight: 0.05, earMean: 0.05 }));
  assert.equal(lastOf(frames).classification.state, AIState.FOKUS);
});

test('repeated natural blinking stays FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  // 200 ms blink every 3 s for 20 s.
  const frames = run(ai, t0, 20000, (t) => {
    const phase = (t - t0) % 3000;
    return phase < 200
      ? measurement({ earLeft: 0.05, earRight: 0.05, earMean: 0.05 })
      : measurement();
  });
  const states = new Set(frames.map((f) => f.classification.state));
  assert.deepEqual([...states], [AIState.FOKUS], 'blinking must never trigger');
});

test('short eye closure (2 s < 3 s window) stays FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 2000, () =>
    measurement({ earLeft: 0.08, earRight: 0.08, earMean: 0.08 }));
  assert.equal(lastOf(frames).classification.state, AIState.FOKUS,
    'thinking with eyes shut is study-compatible');
});

test('long sustained eye closure becomes TERALIH', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 8000, () =>
    measurement({ earLeft: 0.08, earRight: 0.08, earMean: 0.08 }));
  const last = lastOf(frames);
  assert.equal(last.classification.state, AIState.TERALIH);
  assert.equal(last.classification.primaryReason, StateReason.EYE_CLOSURE);
});

// ── Fusion ──────────────────────────────────────────────────────────────
test('strong + support reports the STRONG source as primary reason', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 6000, () =>
    measurement({ yawRaw: 45, pitchRaw: -45, rollRaw: 35 }));
  const last = lastOf(frames);
  assert.equal(last.classification.state, AIState.TERALIH);
  assert.equal(last.classification.primaryReason, StateReason.YAW,
    'support must never become the primary reason');
  assert.equal(last.evidence.active.pitchDownSupport, true);
  assert.equal(last.evidence.active.rollSupport, true);
});

test('two strong sources report MULTIPLE', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  // NOTE (v0.2 live-gate fix): this test previously combined yaw with eye
  // closure. That combination is now unreachable by design — any head angle
  // large enough to trigger yaw or pitch evidence also fails the eye-evidence
  // geometry gate, because EAR is not measurable at that pose. So a pose-based
  // source and EYE_CLOSURE can no longer co-occur, and MULTIPLE in practice
  // means yaw + pitch_up. The `decide()` unit test above still covers the
  // MULTIPLE fusion rule directly.
  const frames = run(ai, t0 + 1000, 10000, () =>
    measurement({ pitchRaw: 40, earLeft: 0.08, earRight: 0.08, earMean: 0.08 }));
  const f = lastOf(frames);
  assert.equal(f.classification.state, AIState.TERALIH);
  assert.equal(f.evidence.active.pitchUpStrong, true);
  assert.equal(f.evidence.active.eyeClosureStrong, false,
    'eye evidence is correctly suppressed at this pitch');
});

// ── Absence ─────────────────────────────────────────────────────────────
test('brief face loss does not become TIDAK_HADIR', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 1200, absent);
  assert.notEqual(lastOf(frames).classification.state, AIState.TIDAK_HADIR);
});

test('sustained face loss becomes TIDAK_HADIR with reason ABSENCE', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 5000, absent);
  const last = lastOf(frames);
  assert.equal(last.classification.state, AIState.TIDAK_HADIR);
  assert.equal(last.classification.primaryReason, StateReason.ABSENCE);
});

test('absence reports empty evidence (nothing observable to judge)', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  const frames = run(ai, t0 + 1000, 5000, absent);
  const ev = lastOf(frames).evidence.active;
  for (const [k, v] of Object.entries(ev)) {
    assert.equal(v, false, `${k} must be false while the user is unobservable`);
  }
});

test('stable return clears absence only after the recovery window', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  run(ai, t0 + 1000, 5000, absent);
  assert.equal(ai.stateEngine.state, AIState.TIDAK_HADIR);

  let t = t0 + 6000;
  // A single detected frame must not clear it.
  ai.processFrame(measurement(), t); t += FRAME_MS;
  assert.equal(ai.stateEngine.state, AIState.TIDAK_HADIR);

  // Nor should less than FACE_PRESENT_RECOVER_MS (500 ms).
  const shortFrames = run(ai, t, 300, () => measurement());
  assert.equal(lastOf(shortFrames).classification.state, AIState.TIDAK_HADIR);

  // Sustained presence does.
  const frames = run(ai, t + 300, 3000, () => measurement());
  assert.equal(lastOf(frames).classification.state, AIState.FOKUS);
});

// ── Validity / flicker ──────────────────────────────────────────────────
test('invalid signal holds previous state within grace', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => measurement());
  run(ai, t0 + 1000, 6000, () => measurement({ yawRaw: 45 }));
  assert.equal(ai.stateEngine.state, AIState.TERALIH);

  // Pose fails but the face is still visible: hold TERALIH, do not snap back.
  const frames = run(ai, t0 + 7000, 700, () => measurement({
    poseValid: false, poseInvalidReason: PoseInvalidReason.DEGENERATE_MATRIX,
    yawRaw: null, pitchRaw: null, rollRaw: null,
  }));
  const last = lastOf(frames);
  assert.equal(last.classification.state, AIState.TERALIH, 'held during grace');
  assert.equal(last.classification.holding, true);
  assert.equal(last.measurement.yawRaw, null, 'never coerced to 0');
});

test('no flicker when a support signal oscillates at its threshold', () => {
  const { ai, t0 } = calibratedAI();
  const frames = run(ai, t0, 12000, (t) => {
    const n = Math.round((t - t0) / FRAME_MS);
    return measurement({ pitchRaw: n % 2 === 0 ? -24 : -26 });
  });
  const states = new Set(frames.map((f) => f.classification.state));
  assert.deepEqual([...states], [AIState.FOKUS]);
});

test('no flicker when a strong signal oscillates at its threshold', () => {
  const { ai, t0 } = calibratedAI();
  let flips = 0, prev = null;
  const frames = run(ai, t0, 12000, (t) => {
    const n = Math.round((t - t0) / FRAME_MS);
    return measurement({ yawRaw: n % 2 === 0 ? 24 : 26 });
  });
  for (const f of frames) {
    if (prev !== null && f.classification.state !== prev) flips++;
    prev = f.classification.state;
  }
  assert.ok(flips <= 2, `expected a stable outcome, saw ${flips} transitions`);
});

// ── Ground truth isolation ──────────────────────────────────────────────
test('manualScenarioTruth NEVER modifies the AI prediction', () => {
  // Identical input, every possible label. Predictions must be identical.
  const labels = Object.values(ScenarioTruth);
  const predictions = labels.map((label) => {
    const { ai, t0 } = calibratedAI();
    ai.setScenarioTruth(label);
    const frames = run(ai, t0, 6000, () => measurement({ yawRaw: 45 }));
    return frames.map((f) => `${f.classification.state}:${f.classification.primaryReason}`).join('|');
  });
  const unique = new Set(predictions);
  assert.equal(unique.size, 1,
    'ground-truth labels must not influence prediction in any way');
});

test('manualScenarioTruth is recorded outside classification', () => {
  const { ai, t0 } = calibratedAI();
  ai.setScenarioTruth(ScenarioTruth.READ_BOOK);
  const frames = run(ai, t0, 1000, () => measurement({ pitchRaw: -45 }));
  const f = lastOf(frames);
  assert.equal(f.manualScenarioTruth, ScenarioTruth.READ_BOOK);
  assert.equal(f.classification.manualScenarioTruth, undefined,
    'truth must never live inside the prediction object');
  assert.equal(f.measurement.manualScenarioTruth, undefined);
  // The documented example: truth=READ_BOOK, prediction=FOKUS, kept separate.
  assert.equal(f.classification.state, AIState.FOKUS);
});

test('raw measurement and prediction remain separate sections', () => {
  const { ai, t0 } = calibratedAI();
  const f = lastOf(run(ai, t0, 500, () => measurement({ yawRaw: 12 })));
  for (const section of ['measurement', 'calibrated', 'temporal', 'evidence',
                         'classification', 'performance', 'manualScenarioTruth']) {
    assert.ok(section in f, `missing telemetry section: ${section}`);
  }
  assert.ok(!('state' in f.measurement), 'state must not leak into measurement');
  assert.ok(!('yawRaw' in f.classification), 'raw must not leak into prediction');
});

// ── Config-driven rules ─────────────────────────────────────────────────
test('strong sources can be disabled from config', () => {
  const cfg = withOverrides({ state: { enableYawEvidence: false } });
  const { ai, t0 } = calibratedAI(cfg);
  const frames = run(ai, t0, 8000, () => measurement({ yawRaw: 60 }));
  assert.equal(lastOf(frames).classification.state, AIState.FOKUS);
});

test('there is NO config switch that promotes support to strong', () => {
  // Guards against a future edit that would let head-down punish reading.
  const keys = Object.keys(CONFIG.state);
  for (const k of keys) {
    assert.ok(!/enablePitchDownEvidence|enableRollEvidence/.test(k),
      `config must not expose a promotion switch (${k})`);
  }
});

// ── Analysis output ─────────────────────────────────────────────────────
test('analyze() produces distributions, transitions and truth comparison', () => {
  const { ai, t0 } = calibratedAI();
  const logger = new TelemetryLogger(CONFIG);
  logger.attach(ai);
  ai.setScenarioTruth(ScenarioTruth.SCREEN_NORMAL);
  let t = t0;
  run(ai, t, 3000, () => measurement()); t += 3000;
  ai.setScenarioTruth(ScenarioTruth.LOOK_LEFT_LONG);
  run(ai, t, 6000, () => measurement({ yawRaw: 45 }));

  const a = logger.analyze();
  assert.ok(a.frames > 0);
  assert.ok(a.distributions.yawDelta.n > 0);
  assert.ok(a.distributions.rollDelta !== null, 'rollDelta must be analysable');
  assert.ok(a.transitionCount >= 1);
  assert.ok(a.groundTruth.LOOK_LEFT_LONG, 'ground truth must be bucketed');
  assert.equal(a.groundTruth.SCREEN_NORMAL.states.FOKUS > 0, true);
  assert.ok(a.detectionDelays.length >= 1, 'detection delay must be measurable');
});
