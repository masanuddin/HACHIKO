/**
 * Debug Verification verdict semantics (spec §19-§20).
 *
 * These drive the REAL evaluator through `summariseTrial`, the same path the
 * JSON and the workbook use. Nothing here asserts on markup, and nothing
 * constructs a verdict by hand.
 *
 * The governing rule under test: a verdict describes what the EVIDENCE did
 * across the whole bounded window, never what the public state showed at the
 * last sample.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { summariseTrial } from '../tools/debug/DebugSession.js';
import { evaluateDebugTrial, TrialVerdict } from '../tools/debug/evaluateDebugTrial.js';
import { getScenarioByCode } from '../tools/debug/scenarios.js';
import { CONFIG } from '../src/ai/index.js';

const S = CONFIG.state;

const CAL = { status: 'VALID', valid: true, capturedAtIso: 'x',
  baseline: { yaw: -2, pitch: -6, roll: 0, ear: 0.41, sampleCount: 150 } };

/** One neutral, fully-valid sample; override whatever the scenario needs. */
const smp = (o = {}) => ({
  relativeTimeMs: 0,
  yawDelta: 0.8, pitchDelta: 0.3, rollDelta: 0.2, earRelative: 0.98,
  faceDetected: true, headPoseValid: true, eyeEligible: true,
  stateSignalValid: true,
  yawEvidence: false, pitchUpEvidence: false, eyeClosureEvidence: false,
  pitchDownSupport: false, rollSupport: false,
  publicState: 'FOKUS', primaryReason: 'NONE',
  fps: 30, faceInferenceMs: 11, ...o,
});

/**
 * Build a window of `n` samples, applying `shape(i)` to each.
 * 30 fps, so index i is ~33 ms in.
 */
const window_ = (n, shape = () => ({})) =>
  Array.from({ length: n }, (_, i) => smp({ relativeTimeMs: i * 33, ...shape(i) }));

/** Judge a window as the given D-code, through the production path. */
function judge(code, samples) {
  const scenario = getScenarioByCode(code);
  assert.ok(scenario, `no scenario ${code}`);
  return summariseTrial({ samples, calibrationAtStart: CAL }, scenario);
}

const verdictOf = (code, samples) => judge(code, samples).trialVerdict;

// ═══════════════════════════════════════════════════════════════════════
// §19 — THE REGRESSION THAT CAUSED THIS PATCH
// ═══════════════════════════════════════════════════════════════════════
test('V1. D01 FAILS when yaw evidence fired early and cleared by the end', () => {
  // The exact real dry-run: evidence ACTIVE mid-window, then relaxed. Final
  // sample is FOKUS / NONE / yawEvidence=false. The old evaluator read the
  // final public state and scored this PASS.
  const samples = window_(40, (i) => (i >= 10 && i < 25
    ? { yawDelta: 31, yawEvidence: true, yawPersistenceMs: 900 }
    : {}));

  const last = samples[samples.length - 1];
  assert.equal(last.yawEvidence, false, 'the window ends clean...');
  assert.equal(last.publicState, 'FOKUS');
  assert.equal(last.primaryReason, 'NONE');

  const sm = judge('D01', samples);
  assert.equal(sm.trialValidity, 'VALID', 'the trial WAS evaluable');
  assert.equal(sm.trialVerdict, TrialVerdict.FAIL, '...but it must still FAIL');
  assert.equal(sm.matchesExpectation, false);
  assert.equal(sm.observedOutcome, 'Yaw strong evidence activated');
  assert.equal(sm.failureReason, 'Unexpected yaw evidence after persistence');
  // And the verdict is anchored to when it happened, not to the last frame.
  assert.equal(sm.verificationDetails.firstStrongActivationMs, 330);
});

test('V2. the verdict does not read the final public state', () => {
  // Mirror image: the display says TERALIH at the end, but no strong rule ever
  // fired. D01 is about evidence, so this is still a PASS.
  const samples = window_(30, (i) => (i > 25
    ? { publicState: 'TERALIH', primaryReason: 'YAW' } : {}));
  const sm = judge('D01', samples);
  assert.equal(sm.trialVerdict, TrialVerdict.PASS,
    'a display transition alone is not evidence');
  assert.equal(sm.publicStateChanged, true, 'but it is still recorded');
  assert.equal(sm.triggerOccurred, false, 'trigger now means STRONG EVIDENCE');
});

// ═══════════════════════════════════════════════════════════════════════
// D01 — neutral must not manufacture strong evidence
// ═══════════════════════════════════════════════════════════════════════
test('V3. D01 passes on a genuinely neutral window', () => {
  const sm = judge('D01', window_(30));
  assert.equal(sm.trialVerdict, TrialVerdict.PASS);
  assert.equal(sm.observedOutcome, 'No strong evidence activated');
  assert.equal(sm.failureReason, null);
});

test('V4. D01 fails on pitch-up or eye-closure evidence too', () => {
  const up = judge('D01', window_(30, (i) => (i > 10
    ? { pitchDelta: 34, pitchUpEvidence: true } : {})));
  assert.equal(up.trialVerdict, TrialVerdict.FAIL);
  assert.match(up.observedOutcome, /Pitch-up/);

  const eye = judge('D01', window_(30, (i) => (i > 10
    ? { earRelative: 0.5, eyeClosureEvidence: true } : {})));
  assert.equal(eye.trialVerdict, TrialVerdict.FAIL);
  assert.match(eye.observedOutcome, /eye closure/i);
});

test('V5. D01 tolerates a support cue without failing', () => {
  // Support is not strong evidence; failing D01 for a transient support cue
  // would make the baseline scenario unpassable in a real room.
  const sm = judge('D01', window_(30, (i) => (i > 10
    ? { rollDelta: 23, rollSupport: true } : {})));
  assert.equal(sm.trialVerdict, TrialVerdict.PASS);
});

test('V6. D01 with an unusable signal is INVALID, never PASS', () => {
  // Nothing fired — because nothing could be measured. That is an absent
  // measurement, not a correct negative.
  const sm = judge('D01', window_(30, () => ({
    faceDetected: false, headPoseValid: false, stateSignalValid: false })));
  assert.equal(sm.trialVerdict, TrialVerdict.INVALID);
  assert.equal(sm.matchesExpectation, null, 'an unjudgeable trial claims nothing');
});

// ═══════════════════════════════════════════════════════════════════════
// D02 / D03 — sustained yaw, direction-aware
// ═══════════════════════════════════════════════════════════════════════
const YAW = S.STRONG_YAW_DELTA_DEG;

test('V7. D02 passes when LEFT yaw evidence activates', () => {
  // Canonical convention: yaw > 0 is the subject's own LEFT.
  const sm = judge('D02', window_(60, (i) => (i > 15
    ? { yawDelta: YAW + 8, yawEvidence: i > 45, yawPersistenceMs: i * 33 } : {})));
  assert.equal(sm.trialVerdict, TrialVerdict.PASS);
  assert.equal(sm.observedOutcome, 'Yaw strong evidence activated');
});

test('V8. D02 fails when the turn was held but evidence never activated', () => {
  const sm = judge('D02', window_(60, (i) => (i > 15
    ? { yawDelta: YAW + 8, yawPersistenceMs: 400 } : {})));
  assert.equal(sm.trialVerdict, TrialVerdict.FAIL,
    'a sustained turn that never latches is a pipeline failure');
  assert.match(sm.observedOutcome, /never activated/);
});

test('V9. D02 does not PASS on a right-side turn', () => {
  // Wrong direction is a mis-run, not proof about left-yaw handling.
  const sm = judge('D02', window_(60, (i) => (i > 15
    ? { yawDelta: -(YAW + 8), yawEvidence: i > 45 } : {})));
  assert.notEqual(sm.trialVerdict, TrialVerdict.PASS);
  assert.equal(sm.trialVerdict, TrialVerdict.INVALID);
  assert.match(sm.failureReason, /opposite|other way/i);
});

test('V10. D03 mirrors D02 with the sign reversed', () => {
  const ok = judge('D03', window_(60, (i) => (i > 15
    ? { yawDelta: -(YAW + 8), yawEvidence: i > 45 } : {})));
  assert.equal(ok.trialVerdict, TrialVerdict.PASS);

  const noLatch = judge('D03', window_(60, (i) => (i > 15
    ? { yawDelta: -(YAW + 8) } : {})));
  assert.equal(noLatch.trialVerdict, TrialVerdict.FAIL);

  const wrongWay = judge('D03', window_(60, (i) => (i > 15
    ? { yawDelta: YAW + 8, yawEvidence: i > 45 } : {})));
  assert.notEqual(wrongWay.trialVerdict, TrialVerdict.PASS);
});

test('V11. left and right receive identical treatment', () => {
  // The asymmetry guard: the same magnitude and duration, mirrored, must
  // produce the same verdict for D02 and D03.
  const shape = (sign) => (i) => (i > 15
    ? { yawDelta: sign * (YAW + 8), yawEvidence: i > 45,
        yawPersistenceMs: i * 33 } : {});
  assert.equal(verdictOf('D02', window_(60, shape(+1))),
               verdictOf('D03', window_(60, shape(-1))));
});

// ═══════════════════════════════════════════════════════════════════════
// D04 — crossing without duration must not latch
// ═══════════════════════════════════════════════════════════════════════
test('V12. D04 passes when the threshold is crossed but persistence does not', () => {
  const sm = judge('D04', window_(30, (i) => (i >= 8 && i < 14
    ? { yawDelta: YAW + 5, yawPersistenceMs: 200 } : {})));
  assert.equal(sm.trialVerdict, TrialVerdict.PASS);
  assert.equal(sm.observedOutcome,
    'Yaw threshold crossed; persistence did not complete');
});

test('V13. D04 fails if the brief glance latched evidence', () => {
  const sm = judge('D04', window_(30, (i) => (i >= 8 && i < 14
    ? { yawDelta: YAW + 5, yawEvidence: true } : {})));
  assert.equal(sm.trialVerdict, TrialVerdict.FAIL);
  assert.match(sm.failureReason, /brief glance completed/i);
});

test('V14. a motionless D04 is INVALID, not a free PASS', () => {
  // This is the trap: "no evidence activated" is trivially true when the
  // operator never moved, and proves nothing about persistence.
  const sm = judge('D04', window_(30));
  assert.equal(sm.trialVerdict, TrialVerdict.INVALID);
  assert.match(sm.failureReason, /persistence was not tested/i);
  assert.equal(sm.matchesExpectation, null);
});

// ═══════════════════════════════════════════════════════════════════════
// D05 / D06 — pitch, by direction
// ═══════════════════════════════════════════════════════════════════════
const UP = S.STRONG_UP_PITCH_DELTA_DEG;
const DOWN = S.DOWN_PITCH_SUPPORT_DEG;

test('V15. D05 passes only when pitch-up evidence activates', () => {
  const ok = judge('D05', window_(80, (i) => (i > 15
    ? { pitchDelta: UP + 5, pitchUpEvidence: i > 60 } : {})));
  assert.equal(ok.trialVerdict, TrialVerdict.PASS);

  const noLatch = judge('D05', window_(80, (i) => (i > 15
    ? { pitchDelta: UP + 5 } : {})));
  assert.equal(noLatch.trialVerdict, TrialVerdict.FAIL);

  const noChallenge = judge('D05', window_(80));
  assert.equal(noChallenge.trialVerdict, TrialVerdict.INVALID);
});

test('V16. D06 passes on support-only, fails on unrelated strong evidence', () => {
  const ok = judge('D06', window_(80, (i) => (i > 15
    ? { pitchDelta: -(DOWN + 5), pitchDownSupport: i > 50 } : {})));
  assert.equal(ok.trialVerdict, TrialVerdict.PASS,
    'pitch-down alone is support, never strong distraction');
  assert.equal(ok.verificationDetails.pitchDownSupportEverActive, true);

  const bad = judge('D06', window_(80, (i) => (i > 15
    ? { pitchDelta: -(DOWN + 5), pitchDownSupport: true,
        yawEvidence: i > 60 } : {})));
  assert.equal(bad.trialVerdict, TrialVerdict.FAIL);
});

// ═══════════════════════════════════════════════════════════════════════
// D07 — head tilt is support-only
// ═══════════════════════════════════════════════════════════════════════
test('V17. D07 respects support-only semantics', () => {
  const ok = judge('D07', window_(80, (i) => (i > 15
    ? { rollDelta: S.ROLL_SUPPORT_DEG + 4, rollSupport: i > 50 } : {})));
  assert.equal(ok.trialVerdict, TrialVerdict.PASS);

  const bad = judge('D07', window_(80, (i) => (i > 15
    ? { rollDelta: S.ROLL_SUPPORT_DEG + 4, rollSupport: true,
        pitchUpEvidence: i > 60 } : {})));
  assert.equal(bad.trialVerdict, TrialVerdict.FAIL,
    'unrelated strong evidence must not be scored as success');

  const noTilt = judge('D07', window_(80));
  assert.equal(noTilt.trialVerdict, TrialVerdict.INVALID);
});

// ═══════════════════════════════════════════════════════════════════════
// D08 / D09 — eye behaviour
// ═══════════════════════════════════════════════════════════════════════
const EAR = S.EAR_RELATIVE_THRESHOLD;

test('V18. D08 passes on blinks that never latch closure evidence', () => {
  // Short dips below the closure condition, well apart.
  const sm = judge('D08', window_(60, (i) => (i % 20 === 0
    ? { earRelative: EAR - 0.1 } : {})));
  assert.equal(sm.trialVerdict, TrialVerdict.PASS);
  assert.match(sm.observedOutcome, /did not latch/);
});

test('V19. D08 fails if sustained closure evidence activated', () => {
  const sm = judge('D08', window_(60, (i) => (i > 20
    ? { earRelative: EAR - 0.2, eyeClosureEvidence: i > 45 } : {})));
  assert.equal(sm.trialVerdict, TrialVerdict.FAIL);
});

test('V20. D08 with an unusable eye signal is INVALID, not PASS', () => {
  // "No eye evidence activated" must not pass when the eye was never eligible.
  const sm = judge('D08', window_(60, () => ({ eyeEligible: false })));
  assert.equal(sm.trialVerdict, TrialVerdict.INVALID);
  assert.equal(sm.matchesExpectation, null);
});

test('V21. D09 requires the closure evidence itself to activate', () => {
  const ok = judge('D09', window_(120, (i) => (i > 20
    ? { earRelative: EAR - 0.2, eyeClosureEvidence: i > 95 } : {})));
  assert.equal(ok.trialVerdict, TrialVerdict.PASS);

  // Low EAR alone is not the claim: persistence must complete.
  const lowEarOnly = judge('D09', window_(120, (i) => (i > 20
    ? { earRelative: EAR - 0.2 } : {})));
  assert.equal(lowEarOnly.trialVerdict, TrialVerdict.FAIL);
  assert.match(lowEarOnly.observedOutcome, /never activated/);
});

// ═══════════════════════════════════════════════════════════════════════
// D10 — dropout and recovery
// ═══════════════════════════════════════════════════════════════════════
const dead = { faceDetected: false, headPoseValid: false, eyeEligible: false,
  stateSignalValid: false, yawDelta: null, earRelative: null };

test('V22. D10 passes on valid -> dropout -> recovery', () => {
  const sm = judge('D10', window_(90, (i) =>
    (i >= 30 && i < 60 ? dead : {})));
  assert.equal(sm.trialVerdict, TrialVerdict.PASS);
  assert.equal(sm.observedOutcome, 'Signal dropout followed by recovery');
  assert.ok(sm.verificationDetails.dropout.ok);
  assert.ok(sm.verificationDetails.dropout.recoveryMs > 0);
});

test('V23. D10 never passes without a recovery', () => {
  const sm = judge('D10', window_(90, (i) => (i >= 30 ? dead : {})));
  assert.notEqual(sm.trialVerdict, TrialVerdict.PASS);
  assert.match(sm.failureReason, /never recovered/i);
});

test('V24. D10 with no dropout at all is INVALID', () => {
  const sm = judge('D10', window_(90));
  assert.equal(sm.trialVerdict, TrialVerdict.INVALID);
  assert.match(sm.failureReason, /No signal dropout/i);
});

test('V25. D10 fails if evidence was asserted while the signal was dead', () => {
  // The scenario's real claim: nothing is fabricated during the gap.
  const sm = judge('D10', window_(90, (i) => (i >= 30 && i < 60
    ? { ...dead, yawEvidence: true } : {})));
  assert.equal(sm.trialVerdict, TrialVerdict.FAIL);
  assert.match(sm.failureReason, /without a usable signal/i);
});

// ═══════════════════════════════════════════════════════════════════════
// D11 — realistic study behaviour
// ═══════════════════════════════════════════════════════════════════════
test('V26. D11 passes on support-only study posture', () => {
  const sm = judge('D11', window_(120, (i) => (i > 20
    ? { pitchDelta: -(DOWN + 3), pitchDownSupport: true,
        rollDelta: 12 } : {})));
  assert.equal(sm.trialVerdict, TrialVerdict.PASS);
  assert.match(sm.observedOutcome, /support cues only/i);
});

test('V27. D11 fails if study posture was promoted to strong evidence', () => {
  const sm = judge('D11', window_(120, (i) => (i > 20
    ? { pitchDelta: -(DOWN + 3), pitchDownSupport: true,
        pitchUpEvidence: i > 80 } : {})));
  assert.equal(sm.trialVerdict, TrialVerdict.FAIL);
});

// ═══════════════════════════════════════════════════════════════════════
// §17 — PASS / FAIL / INVALID are three distinct outcomes
// ═══════════════════════════════════════════════════════════════════════
test('V28. INVALID is never reported as a match or a mismatch', () => {
  for (const sm of [judge('D04', window_(30)),
                    judge('D10', window_(90)),
                    judge('D01', window_(30, () => ({ faceDetected: false,
                      headPoseValid: false, stateSignalValid: false })))]) {
    assert.equal(sm.trialVerdict, TrialVerdict.INVALID);
    assert.equal(sm.matchesExpectation, null,
      'an unjudgeable trial asserts neither success nor failure');
    assert.ok(sm.failureReason, 'but it always says what was missing');
  }
});

test('V29. FAIL means evaluable-but-wrong, not unmeasurable', () => {
  const sm = judge('D01', window_(40, (i) => (i >= 10 && i < 25
    ? { yawDelta: 31, yawEvidence: true } : {})));
  assert.equal(sm.trialValidity, 'VALID', 'the signal WAS usable');
  assert.equal(sm.trialVerdict, TrialVerdict.FAIL);
  assert.equal(sm.matchesExpectation, false, 'a definite negative result');
});

test('V30. every D-code produces a verdict from one evaluator', () => {
  // No scenario may fall through to an unhandled default.
  for (const code of ['D01', 'D02', 'D03', 'D04', 'D05', 'D06',
                      'D07', 'D08', 'D09', 'D10', 'D11']) {
    const sm = judge(code, window_(60));
    assert.ok(Object.values(TrialVerdict).includes(sm.trialVerdict),
      `${code} produced no verdict`);
    assert.ok(typeof sm.observedOutcome === 'string' && sm.observedOutcome,
      `${code} produced no human wording`);
    assert.ok(!/Unknown scenario/.test(sm.observedOutcome),
      `${code} has no verdict rules`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// §5 — window-wide, and §4 — one authority
// ═══════════════════════════════════════════════════════════════════════
test('V31. activation is detected anywhere in the window', () => {
  for (const at of [0, 5, 20, 39]) {
    const sm = judge('D01', window_(40, (i) => (i === at
      ? { yawEvidence: true } : {})));
    assert.equal(sm.trialVerdict, TrialVerdict.FAIL,
      `a single active sample at index ${at} must be seen`);
  }
});

test('V32. details carry first activation, count and peak persistence', () => {
  const sm = judge('D01', window_(40, (i) => (i >= 10 && i < 25
    ? { yawEvidence: true, yawPersistenceMs: 100 + i } : {})));
  const d = sm.verificationDetails;
  assert.equal(d.yawEverActive, true);
  assert.equal(d.firstStrongActivationMs, 330);
  assert.equal(d.strongActiveSampleCount, 15);
  assert.equal(d.maxYawPersistenceMs, 124);
});

test('V33. the evaluator is the only scorer', () => {
  // Calling it directly must agree with what the summary published: if the
  // summary recomputed anything, these could drift.
  const samples = window_(40, (i) => (i >= 10 && i < 25
    ? { yawDelta: 31, yawEvidence: true } : {}));
  const scenario = getScenarioByCode('D01');
  const sm = summariseTrial({ samples, calibrationAtStart: CAL }, scenario);
  const direct = evaluateDebugTrial({ scenario, samples,
    validity: { trialValidity: sm.trialValidity,
      trialValidityReason: sm.trialValidityReason } });

  assert.equal(sm.trialVerdict, direct.trialVerdict);
  assert.equal(sm.observedOutcome, direct.observedOutcome);
  assert.equal(sm.failureReason, direct.failureReason);
  assert.equal(sm.matchesExpectation, direct.matchesExpectation);
  assert.equal(sm.triggerOccurred, direct.observedTrigger);
});

test('V34. the evaluator restates no threshold of its own', () => {
  // Every challenge criterion must be a CONFIG value, so this file cannot
  // drift from the engine it verifies.
  const y = judge('D04', window_(30, (i) => (i === 10
    ? { yawDelta: S.STRONG_YAW_DELTA_DEG + 1 } : {})));
  assert.equal(y.trialVerdict, TrialVerdict.PASS, 'just over the rule counts');

  const under = judge('D04', window_(30, (i) => (i === 10
    ? { yawDelta: S.STRONG_YAW_DELTA_DEG - 1 } : {})));
  assert.equal(under.trialVerdict, TrialVerdict.INVALID, 'just under does not');

  // The wording quotes the live config rather than a copy.
  assert.match(under.failureReason, new RegExp(`${S.STRONG_YAW_DELTA_DEG}`));
});
