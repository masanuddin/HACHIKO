/**
 * v0.2 FINAL live fix — genuine closed eyes must not be rejected as invalid.
 *
 * A real frontal closure measured L=0.016 R=0.016 (earRelative 0.040) with a
 * valid near-frontal pose, but the engine reported
 * `eyeEvidenceEligible: false, reason: EAR_IMPLAUSIBLE` and stayed FOKUS.
 * The physiological lower bound (EYE_MIN_PLAUSIBLE_EAR: 0.02) rejected exactly
 * the condition eye-closure detection exists to find.
 *
 * The distinction restored here:
 *   measurement VALIDITY      (is this number real?)  -> only impossible values fail
 *   classification THRESHOLD  (is this closure?)      -> EAR_RELATIVE_THRESHOLD
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HachikoAI, EvidenceEngine, CONFIG, AIState, StateReason,
} from '../src/ai/index.js';

const FRAME_MS = 1000 / 30;
// Real observed baselines; pitch stored CANONICAL (device +2.3 -> -2.3).
const REAL = { yaw: -2.8, pitchCanon: -2.3, ear: 0.394 };

function measurement(over = {}) {
  return {
    facePresent: true, poseValid: true, poseInvalidReason: 'NONE',
    yawRaw: REAL.yaw, pitchRaw: REAL.pitchCanon, rollRaw: 0,
    earLeft: REAL.ear, earRight: REAL.ear, earMean: REAL.ear,
    ...over,
  };
}
/** Both eyes at the same EAR. */
const bothEyes = (v, over = {}) =>
  measurement({ earLeft: v, earRight: v, earMean: v, ...over });

function run(ai, startMs, durationMs, build) {
  const frames = [];
  for (let t = startMs; t < startMs + durationMs; t += FRAME_MS) {
    frames.push(ai.processFrame(build(t), t));
  }
  return frames;
}
function calibratedAI() {
  const ai = new HachikoAI(CONFIG);
  ai.startCalibration(0);
  run(ai, 0, CONFIG.calibration.CALIBRATION_DURATION_MS + FRAME_MS, () => measurement());
  assert.equal(ai.calibration.isValid(), true);
  return { ai, t0: CONFIG.calibration.CALIBRATION_DURATION_MS + FRAME_MS };
}
const last = (frames) => frames[frames.length - 1];
const frontal = { poseValid: true, yawDelta: 0, pitchDelta: 0 };

// ── The live bug ────────────────────────────────────────────────────────
test('E1. frontal EAR_L=0.016 EAR_R=0.016 is ELIGIBLE (the live bug)', () => {
  const ev = new EvidenceEngine(CONFIG);
  const out = ev.evaluateEyeEligibility({
    ...frontal, earLeft: 0.016, earRight: 0.016, earMean: 0.016,
  });
  assert.equal(out.eligible, true,
    'a genuinely closed eye must not be called implausible');
  assert.equal(out.reason, 'NONE');
});

test('E2. sustained real closure accumulates EYE_CLOSURE evidence', () => {
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 9000, () => bothEyes(0.016)));
  assert.equal(f.evidence.eyeEligible, true);
  assert.equal(f.evidence.active.eyeClosureStrong, true);
  assert.ok(f.evidence.accumulated.eyeClosureStrong >= CONFIG.state.EYE_CLOSED_PERSIST_MS);
});

test('E3. sustained real closure transitions to TERALIH / EYE_CLOSURE', () => {
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 9000, () => bothEyes(0.016)));
  assert.equal(f.classification.state, AIState.TERALIH);
  assert.equal(f.classification.primaryReason, StateReason.EYE_CLOSURE);
  // earRelative ~ 0.016/0.394 = 0.041, far below the 0.70 threshold.
  assert.ok(f.calibrated.earRelative < 0.1);
});

// ── Blink and short closure must NOT trigger ────────────────────────────
test('E4. short blink at the real closure value remains FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 200, () => bothEyes(0.016)));
  assert.equal(f.evidence.eyeEligible, true, 'eligible, but not yet persistent');
  assert.equal(f.classification.state, AIState.FOKUS);
});

test('E5. repeated realistic blinking remains FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  const frames = run(ai, t0, 20000, (t) =>
    ((t - t0) % 3000) < 200 ? bothEyes(0.016) : measurement());
  const states = new Set(frames.map((f) => f.classification.state));
  assert.deepEqual([...states], [AIState.FOKUS]);
});

test('E6. closure shorter than the persistence window remains FOKUS', () => {
  const { ai, t0 } = calibratedAI();
  // 2 s < EYE_CLOSED_PERSIST_MS (3 s).
  const f = last(run(ai, t0, 2000, () => bothEyes(0.016)));
  assert.equal(f.classification.state, AIState.FOKUS);
});

// ── Impossible values are still rejected ────────────────────────────────
test('E7. negative and non-finite EAR are still rejected', () => {
  const ev = new EvidenceEngine(CONFIG);
  assert.equal(ev.evaluateEyeEligibility({
    ...frontal, earLeft: -0.01, earRight: 0.3, earMean: 0.145,
  }).reason, 'EAR_IMPLAUSIBLE', 'negative EAR is geometrically impossible');
  assert.equal(ev.evaluateEyeEligibility({
    ...frontal, earLeft: NaN, earRight: 0.3, earMean: NaN,
  }).reason, 'EAR_UNAVAILABLE');
  assert.equal(ev.evaluateEyeEligibility({
    ...frontal, earLeft: null, earRight: 0.3, earMean: null,
  }).reason, 'EAR_UNAVAILABLE');
});

test('E8. implausibly high EAR is still rejected', () => {
  const ev = new EvidenceEngine(CONFIG);
  assert.equal(ev.evaluateEyeEligibility({
    ...frontal, earLeft: 2.0, earRight: 2.0, earMean: 2.0,
  }).reason, 'EAR_IMPLAUSIBLE', 'no real eye opens that wide');
});

test('E9. strong left/right asymmetry is still rejected', () => {
  const ev = new EvidenceEngine(CONFIG);
  // The real extreme-yaw reading (1.053 / 0.557 scaled).
  assert.equal(ev.evaluateEyeEligibility({
    ...frontal, earLeft: 0.415, earRight: 0.219, earMean: 0.317,
  }).reason, 'EAR_ASYMMETRIC');
  // One eye closed, one clearly open: a genuine occlusion case.
  assert.equal(ev.evaluateEyeEligibility({
    ...frontal, earLeft: 0.01, earRight: 0.39, earMean: 0.20,
  }).reason, 'EAR_ASYMMETRIC');
  assert.equal(ev.evaluateEyeEligibility({
    ...frontal, earLeft: 0, earRight: 0.39, earMean: 0.195,
  }).reason, 'EAR_ASYMMETRIC');
});

test('E10. bilateral near-zero is agreement, not asymmetry', () => {
  // At near-zero the ratio is unstable: 0.005 vs 0.016 is 0.011 apart but 3.2x.
  // Two genuinely shut eyes must stay eligible.
  const ev = new EvidenceEngine(CONFIG);
  for (const [l, r] of [[0.016, 0.016], [0.005, 0.016], [0.001, 0.02], [0, 0]]) {
    const out = ev.evaluateEyeEligibility({
      ...frontal, earLeft: l, earRight: r, earMean: (l + r) / 2,
    });
    assert.equal(out.eligible, true,
      `both eyes closed (${l}, ${r}) must remain eligible, got ${out.reason}`);
  }
});

// ── Pose gates unchanged: no false closure at extreme angles ────────────
test('E11. low EAR during extreme PITCH remains ineligible', () => {
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 15000, () =>
    bothEyes(0.016, { pitchRaw: REAL.pitchCanon - 45 })));
  assert.equal(f.evidence.eyeEligible, false);
  assert.equal(f.evidence.eyeIneligibleReason, 'PITCH_OUT_OF_RANGE');
  assert.equal(f.evidence.active.eyeClosureStrong, false);
  assert.notEqual(f.classification.primaryReason, StateReason.EYE_CLOSURE);
});

test('E12. low EAR during extreme YAW remains ineligible', () => {
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 9000, () =>
    bothEyes(0.016, { yawRaw: REAL.yaw + 56.3 })));
  assert.equal(f.evidence.eyeEligible, false);
  assert.equal(f.evidence.eyeIneligibleReason, 'YAW_OUT_OF_RANGE');
  assert.equal(f.evidence.active.eyeClosureStrong, false);
  assert.equal(f.classification.primaryReason, StateReason.YAW,
    'yaw evidence is unaffected');
});

// ── Telemetry and separation of concerns ────────────────────────────────
test('E13. raw EAR telemetry is preserved regardless of eligibility', () => {
  const { ai, t0 } = calibratedAI();
  const ok = last(run(ai, t0, 1000, () => bothEyes(0.016)));
  assert.equal(ok.evidence.eyeEligible, true);
  assert.ok(Math.abs(ok.measurement.earLeft - 0.016) < 1e-9);

  // Identical EAR, extreme pose -> ineligible, but still logged.
  const second = calibratedAI();
  const bad = last(run(second.ai, second.t0, 1000, () =>
    bothEyes(0.016, { yawRaw: REAL.yaw + 56.3 })));
  assert.equal(bad.evidence.eyeEligible, false);
  assert.ok(Math.abs(bad.measurement.earLeft - 0.016) < 1e-9,
    'raw EAR survives even when it cannot be used as evidence');
  assert.ok(Math.abs(bad.measurement.earRight - 0.016) < 1e-9);
  assert.ok(Number.isFinite(bad.calibrated.earRelative));
});

test('E14. validity and classification remain separate concerns', () => {
  // EAR_RELATIVE_THRESHOLD is untouched: an eligible but OPEN eye is not closure.
  assert.equal(CONFIG.state.EAR_RELATIVE_THRESHOLD, 0.70);
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 9000, () => bothEyes(REAL.ear * 0.95)));
  assert.equal(f.evidence.eyeEligible, true, 'measurement is valid');
  assert.equal(f.evidence.active.eyeClosureStrong, false, 'but not closure');
  assert.equal(f.classification.state, AIState.FOKUS);
});

// ── Unchanged semantics ─────────────────────────────────────────────────
test('E15. yaw semantics unchanged', () => {
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 9000, () => measurement({ yawRaw: REAL.yaw - 33.4 })));
  assert.equal(f.classification.state, AIState.TERALIH);
  assert.equal(f.classification.primaryReason, StateReason.YAW);
});

test('E16. pitch-up / pitch-down semantics unchanged', () => {
  const up = calibratedAI();
  const fUp = last(run(up.ai, up.t0, 9000, () =>
    measurement({ pitchRaw: REAL.pitchCanon + 46.4 })));
  assert.equal(fUp.classification.primaryReason, StateReason.PITCH_UP);

  const down = calibratedAI();
  const fDown = last(run(down.ai, down.t0, 15000, () =>
    measurement({ pitchRaw: REAL.pitchCanon - 45 })));
  assert.equal(fDown.classification.state, AIState.FOKUS);
  assert.equal(fDown.evidence.active.pitchDownSupport, true);
});

test('E17. roll remains support-only', () => {
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 15000, () => measurement({ rollRaw: 40 })));
  assert.equal(f.classification.state, AIState.FOKUS);
  assert.equal(f.evidence.active.rollSupport, true);
});
