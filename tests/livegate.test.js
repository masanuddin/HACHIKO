/**
 * v0.2 LIVE-GATE regression tests.
 *
 * Every number here comes from a REAL Gate-1 webcam run, not from theory:
 *
 *   calibration baselines : yaw -2.8 deg, pitch +2.3 deg (device), EAR 0.394
 *   neutral               : yawDelta +1.5, pitchDelta -3.3, earRelative 1.055
 *   LOOK UP               : device pitchDelta -46.4, earRelative 0.667
 *   LOOK DOWN             : device pitchDelta +21.8, earRelative 0.220
 *   extreme yaw side A    : yawDelta +56.3, earL 1.053, earR 0.557, earRel 2.045
 *   extreme yaw side B    : yawDelta -33.4, earL 0.419, earR 0.702, earRel 1.423
 *
 * Two defects those numbers exposed:
 *   BUG 1 pitch sign was inverted relative to the canonical convention, so
 *         PITCH_UP (strong) and PITCH_DOWN (support) were swapped.
 *   BUG 2 EAR collapses at non-frontal head angles with the eyes fully OPEN
 *         (0.220 while looking down), producing false EYE_CLOSURE.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HachikoAI, HeadPoseExtractor, EvidenceEngine,
  CONFIG, withOverrides, AIState, StateReason,
} from '../src/ai/index.js';

const FRAME_MS = 1000 / 30;
const D = Math.PI / 180;

// Real observed baselines. pitch is stored CANONICAL (device +2.3 -> -2.3).
const REAL = { yaw: -2.8, pitchCanon: -2.3, ear: 0.394 };

function measurement(over = {}) {
  return {
    facePresent: true, poseValid: true, poseInvalidReason: 'NONE',
    yawRaw: REAL.yaw, pitchRaw: REAL.pitchCanon, rollRaw: 0,
    earLeft: REAL.ear, earRight: REAL.ear, earMean: REAL.ear,
    ...over,
  };
}
/** EAR scaled by a relative factor, both eyes equal unless overridden. */
function withEar(rel, over = {}) {
  const v = REAL.ear * rel;
  return measurement({ earLeft: v, earRight: v, earMean: v, ...over });
}
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
  run(ai, 0, config.calibration.CALIBRATION_DURATION_MS + FRAME_MS, () => measurement());
  assert.equal(ai.calibration.isValid(), true, 'calibration must succeed');
  return { ai, t0: config.calibration.CALIBRATION_DURATION_MS + FRAME_MS };
}
const last = (frames) => frames[frames.length - 1];

// Build a MediaPipe-shaped matrix for a given DEVICE-frame rotation.
function mul(A, B) { return A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0))); }
const Ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const Rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const Rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const compose = (y, p, r) => mul(mul(Ry(y * D), Rx(p * D)), Rz(r * D));
const toMatrix = (R) => ({
  rows: 4, columns: 4,
  data: [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0,
         R[0][2], R[1][2], R[2][2], 0, 0, 0, 0, 1],
});

// ── BUG 1: canonical pitch ──────────────────────────────────────────────
test('1. device NEGATIVE pitch (real LOOK UP) becomes canonical POSITIVE up', () => {
  const ex = new HeadPoseExtractor(CONFIG);
  const out = ex.extract(toMatrix(compose(0, -46.4, 0)));
  assert.equal(out.poseValid, true);
  assert.ok(out.pitchRaw > 0,
    `real LOOK UP must be canonically positive, got ${out.pitchRaw}`);
  assert.ok(Math.abs(out.pitchRaw - 46.4) < 1e-6);
});

test('2. device POSITIVE pitch (real LOOK DOWN) becomes canonical NEGATIVE down', () => {
  const ex = new HeadPoseExtractor(CONFIG);
  const out = ex.extract(toMatrix(compose(0, 21.8, 0)));
  assert.ok(out.pitchRaw < 0,
    `real LOOK DOWN must be canonically negative, got ${out.pitchRaw}`);
  assert.ok(Math.abs(out.pitchRaw + 21.8) < 1e-6);
});

test('canonicalization leaves yaw and roll untouched', () => {
  const ex = new HeadPoseExtractor(CONFIG);
  for (const yaw of [-33.4, 56.3]) {
    const out = ex.extract(toMatrix(compose(yaw, 0, 0)));
    assert.ok(Math.abs(out.yawRaw - yaw) < 1e-6, `yaw ${yaw} must pass through`);
  }
  for (const roll of [-25, 30]) {
    const out = ex.extract(toMatrix(compose(0, 0, roll)));
    assert.ok(Math.abs(out.rollRaw - roll) < 1e-6, `roll ${roll} must pass through`);
  }
});

test('3. sustained real LOOK UP accumulates PITCH_UP strong evidence', () => {
  const { ai, t0 } = calibratedAI();
  const frames = run(ai, t0, 9000, () =>
    withEar(0.667, { pitchRaw: REAL.pitchCanon + 46.4 }));
  const f = last(frames);
  assert.equal(f.evidence.active.pitchUpStrong, true);
  assert.equal(f.classification.state, AIState.TERALIH);
  assert.equal(f.classification.primaryReason, StateReason.PITCH_UP);
});

test('4. sustained real LOOK DOWN accumulates PITCH_DOWN support evidence', () => {
  const { ai, t0 } = calibratedAI();
  // -45 deg canonical: past DOWN_PITCH_SUPPORT_DEG (25).
  const frames = run(ai, t0, 12000, () =>
    withEar(0.220, { pitchRaw: REAL.pitchCanon - 45 }));
  const f = last(frames);
  assert.equal(f.evidence.active.pitchDownSupport, true, 'support must register');
  assert.equal(f.evidence.active.pitchUpStrong, false, 'must NOT be up');
});

test('5. LOOK DOWN alone never produces TERALIH, at any depth or duration', () => {
  for (const depth of [21.8, 35, 45, 60]) {
    const { ai, t0 } = calibratedAI();
    const frames = run(ai, t0, 20000, () =>
      withEar(0.220, { pitchRaw: REAL.pitchCanon - depth }));
    assert.equal(last(frames).classification.state, AIState.FOKUS,
      `look-down ${depth} deg must stay FOKUS (reading/writing)`);
  }
});

// ── BUG 2: eye-evidence eligibility ─────────────────────────────────────
test('6. open-eye low EAR from extreme LOOK UP does not accumulate eye closure', () => {
  const { ai, t0 } = calibratedAI();
  // Real: earRelative 0.667, below the 0.70 closure threshold, eyes OPEN.
  const frames = run(ai, t0, 12000, () =>
    withEar(0.667, { pitchRaw: REAL.pitchCanon + 46.4 }));
  const f = last(frames);
  assert.equal(f.evidence.eyeEligible, false);
  assert.equal(f.evidence.eyeIneligibleReason, 'PITCH_OUT_OF_RANGE');
  assert.equal(f.evidence.active.eyeClosureStrong, false);
  assert.equal(f.evidence.accumulated.eyeClosureStrong, 0,
    'ineligible frames must not accumulate');
  assert.notEqual(f.classification.primaryReason, StateReason.EYE_CLOSURE);
});

test('7. open-eye low EAR from extreme LOOK DOWN does not accumulate eye closure', () => {
  const { ai, t0 } = calibratedAI();
  // Real: earRelative 0.220 with eyes fully open — the worst case.
  const frames = run(ai, t0, 20000, () =>
    withEar(0.220, { pitchRaw: REAL.pitchCanon - 45 }));
  const f = last(frames);
  assert.equal(f.evidence.eyeEligible, false);
  assert.equal(f.evidence.active.eyeClosureStrong, false);
  assert.equal(f.evidence.accumulated.eyeClosureStrong, 0);
  assert.equal(f.classification.state, AIState.FOKUS,
    'reading must never be reported as eye closure');
});

test('8. extreme yaw makes eye evidence ineligible', () => {
  const { ai, t0 } = calibratedAI();
  // Real side A: yawDelta +56.3, earL 1.053 vs earR 0.557 (asymmetric).
  const frames = run(ai, t0, 9000, () => measurement({
    yawRaw: REAL.yaw + 56.3,
    earLeft: REAL.ear * 1.053, earRight: REAL.ear * 0.557, earMean: REAL.ear * 0.805,
  }));
  const f = last(frames);
  assert.equal(f.evidence.eyeEligible, false);
  assert.equal(f.evidence.active.eyeClosureStrong, false);
  // Yaw evidence itself is unaffected.
  assert.equal(f.classification.state, AIState.TERALIH);
  assert.equal(f.classification.primaryReason, StateReason.YAW);
});

test('left/right EAR asymmetry alone makes eye evidence ineligible', () => {
  const ev = new EvidenceEngine(CONFIG);
  // Frontal pose, but the observed 1.053 / 0.557 asymmetry (ratio 1.89).
  const out = ev.evaluateEyeEligibility({
    poseValid: true, yawDelta: 0, pitchDelta: 0,
    earLeft: 0.415, earRight: 0.219, earMean: 0.317,
  });
  assert.equal(out.eligible, false);
  assert.equal(out.reason, 'EAR_ASYMMETRIC');
});

test('9. EAR telemetry is still emitted when eye evidence is ineligible', () => {
  const { ai, t0 } = calibratedAI();
  const frames = run(ai, t0, 3000, () =>
    withEar(0.220, { pitchRaw: REAL.pitchCanon - 45 }));
  const f = last(frames);
  assert.equal(f.evidence.eyeEligible, false, 'precondition: ineligible');
  // Measurement and calibrated EAR must survive for pilot analysis.
  assert.ok(Number.isFinite(f.measurement.earLeft), 'earLeft still logged');
  assert.ok(Number.isFinite(f.measurement.earRight), 'earRight still logged');
  assert.ok(Number.isFinite(f.measurement.earMean), 'earMean still logged');
  assert.ok(Number.isFinite(f.calibrated.earRelative), 'earRelative still logged');
  assert.ok(Math.abs(f.calibrated.earRelative - 0.220) < 0.01,
    'the real ineligible value is preserved verbatim');
});

test('10. frontal eye closure still triggers EYE_CLOSURE after persistence', () => {
  const { ai, t0 } = calibratedAI();
  const frames = run(ai, t0, 9000, () => withEar(0.25));
  const f = last(frames);
  assert.equal(f.evidence.eyeEligible, true, 'frontal geometry stays eligible');
  assert.equal(f.classification.state, AIState.TERALIH);
  assert.equal(f.classification.primaryReason, StateReason.EYE_CLOSURE);
});

test('11. normal blink remains FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  const frames = run(ai, t0, 20000, (t) => {
    const phase = (t - t0) % 3000;
    return phase < 200 ? withEar(0.15) : measurement();
  });
  const states = new Set(frames.map((f) => f.classification.state));
  assert.deepEqual([...states], [AIState.FOKUS]);
});

test('eye timer hard-resets when geometry becomes ineligible mid-closure', () => {
  const { ai, t0 } = calibratedAI();
  let t = t0;
  // 2 s of genuine frontal closure — accumulating but not yet at 3 s.
  run(ai, t, 2000, () => withEar(0.25)); t += 2000;
  assert.ok(ai.temporal.timers.eyeClosureStrong.accumulatedMs > 1000);
  // Head turns away: accumulation must be discarded, not merely paused.
  const away = run(ai, t, 500, () => withEar(0.25, { yawRaw: REAL.yaw + 50 }));
  assert.equal(last(away).evidence.accumulated.eyeClosureStrong, 0,
    'ineligible geometry must clear the timer, not pause it');
});

// ── Unchanged behaviour ─────────────────────────────────────────────────
test('12. yaw -> TERALIH behaviour is unchanged', () => {
  const { ai, t0 } = calibratedAI();
  // Real side B: yawDelta -33.4, which did trigger correctly on hardware.
  const frames = run(ai, t0, 9000, () => measurement({
    yawRaw: REAL.yaw - 33.4,
    earLeft: REAL.ear * 0.419, earRight: REAL.ear * 0.702, earMean: REAL.ear * 0.56,
  }));
  const f = last(frames);
  assert.equal(f.classification.state, AIState.TERALIH);
  assert.equal(f.classification.primaryReason, StateReason.YAW);
});

test('13. absence behaviour is unchanged', () => {
  const { ai, t0 } = calibratedAI();
  const gone = () => measurement({
    facePresent: false, poseValid: false, poseInvalidReason: 'NO_FACE',
    yawRaw: null, pitchRaw: null, rollRaw: null,
    earLeft: null, earRight: null, earMean: null,
  });
  run(ai, t0, 1000, () => measurement());
  // Brief loss stays put.
  assert.notEqual(
    last(run(ai, t0 + 1000, 1200, gone)).classification.state,
    AIState.TIDAK_HADIR);
  // Sustained loss becomes absent.
  const f = last(run(ai, t0 + 2200, 4000, gone));
  assert.equal(f.classification.state, AIState.TIDAK_HADIR);
  assert.equal(f.classification.primaryReason, StateReason.ABSENCE);
});

test('neutral real values stay FOKUS and eligible', () => {
  const { ai, t0 } = calibratedAI();
  // Real neutral: yawDelta +1.5, pitchDelta -3.3, earRelative 1.055.
  const frames = run(ai, t0, 9000, () =>
    withEar(1.055, { yawRaw: REAL.yaw + 1.5, pitchRaw: REAL.pitchCanon - 3.3 }));
  const f = last(frames);
  assert.equal(f.classification.state, AIState.FOKUS);
  assert.equal(f.evidence.eyeEligible, true);
});

// ── Eligibility limits are config-driven ────────────────────────────────
test('eligibility limits come from config, not hardcoded values', () => {
  // Widen the pitch limit past the real look-down angle: the SAME input then
  // becomes eligible, proving the gate reads config.
  const cfg = withOverrides({
    eye: { ...CONFIG.eye, eligibility: { ...CONFIG.eye.eligibility, EYE_MAX_ABS_PITCH_DEG: 60 } },
  });
  const ev = new EvidenceEngine(cfg);
  const at45 = { poseValid: true, yawDelta: 0, pitchDelta: -45, earLeft: 0.3, earRight: 0.3, earMean: 0.3 };
  assert.equal(ev.evaluateEyeEligibility(at45).eligible, true);
  assert.equal(new EvidenceEngine(CONFIG).evaluateEyeEligibility(at45).eligible, false);
});

test('eligibility rejects invalid pose and unavailable deltas', () => {
  const ev = new EvidenceEngine(CONFIG);
  assert.equal(ev.evaluateEyeEligibility({
    poseValid: false, yawDelta: 0, pitchDelta: 0, earLeft: 0.3, earRight: 0.3, earMean: 0.3,
  }).reason, 'POSE_INVALID');
  // Uncalibrated: no deltas, so we cannot know how far from frontal we are.
  assert.equal(ev.evaluateEyeEligibility({
    poseValid: true, yawDelta: null, pitchDelta: null, earLeft: 0.3, earRight: 0.3, earMean: 0.3,
  }).reason, 'POSE_DELTA_UNAVAILABLE');
  assert.equal(ev.evaluateEyeEligibility({
    poseValid: true, yawDelta: 0, pitchDelta: 0, earLeft: null, earRight: 0.3, earMean: null,
  }).reason, 'EAR_UNAVAILABLE');
  assert.equal(ev.evaluateEyeEligibility({
    poseValid: true, yawDelta: 0, pitchDelta: 0, earLeft: 5, earRight: 5, earMean: 5,
  }).reason, 'EAR_IMPLAUSIBLE');
});
