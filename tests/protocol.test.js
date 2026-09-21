/**
 * Debug protocol fixes + stable-baseline regression guards (spec §19).
 *
 * Two jobs:
 *   1. hold the protocol/evaluator fixes (clean start, progress semantics,
 *      D04 direction+duration, D09 wording, D10 grace),
 *   2. FREEZE the components the engineering session found stable, so the
 *      parameter tuning that follows cannot quietly degrade them.
 *
 * No test here selects a parameter value. Tuning comparisons live in
 * tests/tuning.test.js and run against candidate configs without mutating
 * the baseline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { DebugSession, summariseTrial, isEvaluable } from '../tools/debug/DebugSession.js';
import { TrialVerdict } from '../tools/debug/evaluateDebugTrial.js';
import { getScenarioByCode } from '../tools/debug/scenarios.js';
import { TemporalTracker } from '../src/ai/pipeline/TemporalTracker.js';
import { EvidenceEngine } from '../src/ai/pipeline/EvidenceEngine.js';
import { CONFIG } from '../src/ai/index.js';

const S = CONFIG.state;
const CAL = { status: 'VALID', valid: true, capturedAtIso: 'x',
  baseline: { yaw: -2, pitch: -6, roll: 0, ear: 0.41, sampleCount: 150 } };

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
const window_ = (n, shape = () => ({})) =>
  Array.from({ length: n }, (_, i) => smp({ relativeTimeMs: i * 33, ...shape(i) }));
const judge = (code, samples) =>
  summariseTrial({ samples, calibrationAtStart: CAL }, getScenarioByCode(code));

// ═══════════════════════════════════════════════════════════════════════
// §3 — pre-trial contamination
// ═══════════════════════════════════════════════════════════════════════
test('P1. persistence accrued before the window does not carry into it', () => {
  const mk = () => new TemporalTracker(CONFIG, new EvidenceEngine(CONFIG));
  const frame = (yaw) => ({ facePresent: true, signalValid: true,
    yawSmoothed: yaw, pitchSmoothed: 0, rollSmoothed: 0, earSmoothed: 1.0 });

  /** Latch delay, measured from when the bounded window opens. */
  const latchDelay = (tracker) => {
    let now = 0;
    const step = (yaw) => { now += 33; return tracker.update(frame(yaw), now); };
    // Countdown: the operator is already turned. ~1.2 s banks up.
    for (let i = 0; i < 36; i++) step(S.STRONG_YAW_DELTA_DEG + 7);
    const contaminated = tracker.timers.yawStrong.accumulatedMs;

    if (tracker._cleanStart) tracker.reset();     // the fix, at the boundary

    const start = now;
    let latched = null;
    for (let i = 0; i < 80; i++) {
      const r = step(S.STRONG_YAW_DELTA_DEG + 7);
      if (r.persisted.yawStrong && latched === null) latched = now - start;
    }
    return { contaminated, latched };
  };

  const dirty = latchDelay(mk());
  assert.ok(dirty.contaminated > 1000, 'the countdown really does bank time');
  assert.ok(dirty.latched < S.YAW_PERSIST_MS / 2,
    `without a clean start the trial latches in ${dirty.latched}ms — a `
    + 'persistence it never measured');

  const clean = mk(); clean._cleanStart = true;
  const fixed = latchDelay(clean);
  assert.ok(Math.abs(fixed.latched - S.YAW_PERSIST_MS) < 100,
    `a clean start latches at the configured ${S.YAW_PERSIST_MS}ms, `
    + `got ${fixed.latched}ms`);
});

test('P2. the harness clears temporal evidence at the RECORDING boundary', async () => {
  const { DebugHarness } = await import('../tools/debug/DebugHarness.js');
  const els = {};
  for (const k of ['video', 'status']) els[k] = { textContent: '', style: {} };
  const h = new DebugHarness({ FilesetResolver: {}, FaceLandmarker: {} }, els);
  h.trials.cameraStarted();
  h.trials.selectScenario(getScenarioByCode('D02'));
  h.ai.getCalibrationSnapshot = () => CAL;

  let cleared = 0;
  const realReset = h.ai.resetTemporalEvidence.bind(h.ai);
  h.ai.resetTemporalEvidence = () => { cleared += 1; return realReset(); };

  assert.equal(h.startTrial().ok, true);
  assert.equal(cleared, 0, 'countdown start must not be the evidence boundary');
  h.trials.tick(h.trials.countdownStartedAt + h.trials.scenario.countdownMs);
  assert.equal(cleared, 1, 'RECORDING start must clear accumulated evidence');
});

test('P3. the clean start does NOT reset calibration', async () => {
  const { HachikoAI } = await import('../src/ai/HachikoAI.js');
  const ai = new HachikoAI(CONFIG);
  const before = ai.getCalibrationSnapshot();
  ai.resetTemporalEvidence();
  const after = ai.getCalibrationSnapshot();
  // Every delta in the trial is measured against the baseline; re-deriving it
  // at the boundary would change what the trial's numbers mean.
  assert.deepEqual(after, before, 'the baseline must survive a clean start');
});

// ═══════════════════════════════════════════════════════════════════════
// §4 — progress semantics
// ═══════════════════════════════════════════════════════════════════════
/** Save one trial whose verdict is PASS / FAIL / INVALID, as asked. */
function saveTrial(session, code, want) {
  const sc = getScenarioByCode(code);
  const shapes = {
    // D01 neutral: clean = PASS, strong evidence = FAIL, dead signal = INVALID.
    PASS: () => window_(30),
    FAIL: () => window_(30, (i) => (i > 10 ? { yawEvidence: true } : {})),
    INVALID: () => window_(30, () => ({ faceDetected: false,
      headPoseValid: false, stateSignalValid: false })),
  };
  const ref = session.nextTrialRef(sc.id);
  return session.addTrial({ trialId: ref.trialId, scenario: sc.id,
    repetition: ref.repetition, recordingDurationMs: 10000,
    sampleCount: 30, samples: shapes[want]() }, sc, CAL);
}

test('P4. INVALID does not consume one of the official three', () => {
  const s = new DebugSession();
  saveTrial(s, 'D01', 'PASS');
  saveTrial(s, 'D01', 'INVALID');
  saveTrial(s, 'D01', 'PASS');

  const t = s.scenarioTally('NEUTRAL_FRONTAL');
  assert.equal(t.attempts, 3, 'all three are recorded...');
  assert.equal(t.evaluable, 2, '...but only two produced evidence');
  assert.equal(t.invalid, 1);
  assert.equal(s.evaluableCount('NEUTRAL_FRONTAL'), 2);

  const p = s.progress([getScenarioByCode('D01')])[0];
  assert.equal(p.done, 2, 'progress counts evaluable repetitions');
  assert.equal(p.complete, false, 'two evaluable is not three');
});

test('P5. FAIL counts as evidence and completes a repetition', () => {
  // A failure is a real result. Retrying until it turns green would select the
  // dataset for its conclusion.
  const s = new DebugSession();
  saveTrial(s, 'D01', 'PASS');
  saveTrial(s, 'D01', 'INVALID');
  saveTrial(s, 'D01', 'PASS');
  saveTrial(s, 'D01', 'FAIL');

  const t = s.scenarioTally('NEUTRAL_FRONTAL');
  assert.deepEqual(t, { attempts: 4, evaluable: 3, pass: 2, fail: 1, invalid: 1 });
  const p = s.progress([getScenarioByCode('D01')])[0];
  assert.equal(p.complete, true, 'three evaluable repetitions is complete');
  // ...and completion must never be read as "all passed".
  assert.notEqual(t.pass, t.evaluable);
});

test('P6. an INVALID attempt is kept, never deleted', () => {
  const s = new DebugSession();
  saveTrial(s, 'D01', 'INVALID');
  assert.equal(s.trials.length, 1, 'the attempt stays in the record');
  const doc = s.buildResultsJson({});
  assert.equal(doc.trials.length, 1, 'and reaches the export');
  assert.equal(doc.trials[0].summary.trialVerdict, TrialVerdict.INVALID);
  assert.equal(doc.trials[0].samples.length, 30, 'with its telemetry intact');
});

test('P7. isEvaluable is the single rule, and refuses to guess', () => {
  assert.equal(isEvaluable({ summary: { trialVerdict: 'PASS' } }), true);
  assert.equal(isEvaluable({ summary: { trialVerdict: 'FAIL' } }), true);
  assert.equal(isEvaluable({ summary: { trialVerdict: 'INVALID' } }), false);
  // A record with no verdict is not assumed good.
  assert.equal(isEvaluable({ summary: {} }), false);
  assert.equal(isEvaluable({}), false);
});

test('P8. progress exposes the full tally, hiding nothing', () => {
  const s = new DebugSession();
  for (const w of ['PASS', 'INVALID', 'FAIL', 'INVALID']) saveTrial(s, 'D01', w);
  const p = s.progress([getScenarioByCode('D01')])[0];
  for (const k of ['attempts', 'evaluable', 'pass', 'fail', 'invalid']) {
    assert.ok(k in p, `progress must report ${k}`);
  }
  assert.equal(p.attempts, 4);
  assert.equal(p.invalid, 2, 'invalid attempts are visible, not swallowed');
});

// ═══════════════════════════════════════════════════════════════════════
// §5 — D04
// ═══════════════════════════════════════════════════════════════════════
const YAW = S.STRONG_YAW_DELTA_DEG;

test('P9. D04 accepts a brief glance to EITHER side', () => {
  for (const [side, sign] of [['left', +1], ['right', -1]]) {
    const sm = judge('D04', window_(90, (i) => (i >= 8 && i < 16
      ? { yawDelta: sign * (YAW + 6), yawSmoothed: sign * (YAW + 6),
        yawInstantaneous: true } : {})));
    assert.equal(sm.trialVerdict, TrialVerdict.PASS, `${side} glance must pass`);
    assert.equal(sm.observedOutcome,
      'Yaw threshold crossed; persistence did not complete');
  }
});

test('P10. D04 still fails when the glance latched evidence', () => {
  const sm = judge('D04', window_(90, (i) => (i >= 8 && i < 16
    ? { yawDelta: YAW + 6, yawSmoothed: YAW + 6,
      yawInstantaneous: true, yawEvidence: true } : {})));
  assert.equal(sm.trialVerdict, TrialVerdict.FAIL);
});

test('P11. D04 without a real glance is INVALID', () => {
  const sm = judge('D04', window_(90));
  assert.equal(sm.trialVerdict, TrialVerdict.INVALID);
  assert.equal(sm.matchesExpectation, null);
});

test('P12. the D04 window outlasts the persistence rule', () => {
  // Otherwise "evidence did not latch" is a statement about the recording
  // having stopped, not about the glance.
  const d04 = getScenarioByCode('D04');
  assert.ok(d04.recordingDurationMs > S.YAW_PERSIST_MS,
    `D04 records ${d04.recordingDurationMs}ms against a `
    + `${S.YAW_PERSIST_MS}ms rule`);
  assert.ok(d04.recordingDurationMs >= 2500 && d04.recordingDurationMs <= 3500);
});

// ═══════════════════════════════════════════════════════════════════════
// §6 / §9 — D06 and D09 protocol
// ═══════════════════════════════════════════════════════════════════════
test('P13. D06 asks for natural study posture, not a chased angle', () => {
  const d06 = getScenarioByCode('D06');
  assert.match(d06.instruction, /natural study posture/i);
  assert.ok(/do not exaggerate|chase a threshold/i.test(d06.instruction),
    'the instruction must not push the operator to perform the threshold');
  assert.equal(d06.triggerExpected, false);
});

test('P14. D06 support activity never becomes a strong verdict', () => {
  const DOWN = S.DOWN_PITCH_SUPPORT_DEG;
  const sm = judge('D06', window_(120, (i) => (i > 15
    ? { pitchDelta: -(DOWN + 4), pitchDownSupport: i > 50 } : {})));
  assert.equal(sm.trialVerdict, TrialVerdict.PASS);
  assert.equal(sm.verificationDetails.pitchDownSupportEverActive, true);
  assert.equal(sm.verificationDetails.yawEverActive, false);
  assert.equal(sm.verificationDetails.pitchUpEverActive, false);
});

test('P15. D09 gives an unambiguous, comfortably long challenge', () => {
  const d09 = getScenarioByCode('D09');
  assert.match(d09.instruction, /as soon as recording begins/i);
  assert.match(d09.instruction, /until the trial ends/i);
  assert.ok(d09.recordingDurationMs >= S.EYE_CLOSED_PERSIST_MS + 3000,
    'the window must leave real headroom over the persistence rule');
  assert.ok(d09.recordingDurationMs >= 6500 && d09.recordingDurationMs <= 7000);
});

// ═══════════════════════════════════════════════════════════════════════
// §10 — D10 grace semantics
// ═══════════════════════════════════════════════════════════════════════
const dead = { faceDetected: false, headPoseValid: false, eyeEligible: false,
  stateSignalValid: false, yawDelta: null, earRelative: null };

test('P16. evidence carried into the grace window is NOT fabrication', () => {
  // Production HOLDs for SIGNAL_INVALID_GRACE_MS after the signal dies, so
  // evidence already active when it died legitimately persists for a moment.
  const grace = CONFIG.validity.SIGNAL_INVALID_GRACE_MS;
  const carry = Math.floor((grace * 0.6) / 33);
  const sm = judge('D10', window_(90, (i) => {
    if (i < 30) return { yawEvidence: i >= 25 };      // active while valid
    if (i < 60) return { ...dead, yawEvidence: i < 30 + carry }; // carried
    return {};                                        // recovered
  }));
  assert.equal(sm.trialVerdict, TrialVerdict.PASS,
    'honest carry-through must not be called fabrication');
});

test('P17. evidence created from nothing during a dropout still FAILS', () => {
  // Inactive before the dropout, active during it: that is invention.
  const sm = judge('D10', window_(90, (i) => {
    if (i < 30) return {};
    if (i < 60) return { ...dead, yawEvidence: i > 45 };
    return {};
  }));
  assert.equal(sm.trialVerdict, TrialVerdict.FAIL);
  assert.match(sm.failureReason, /without a usable signal/i);
});

test('P18. carry-through beyond the grace window is fabrication', () => {
  const sm = judge('D10', window_(120, (i) => {
    if (i < 30) return { yawEvidence: i >= 25 };
    if (i < 90) return { ...dead, yawEvidence: true };  // ~2s, past 1s grace
    return {};
  }));
  assert.equal(sm.trialVerdict, TrialVerdict.FAIL);
});

test('P19. a dropout with no recovery can never PASS', () => {
  const sm = judge('D10', window_(90, (i) => (i >= 30 ? dead : {})));
  assert.notEqual(sm.trialVerdict, TrialVerdict.PASS);
});

// ═══════════════════════════════════════════════════════════════════════
// §16 — FREEZE the components the pilot found stable
// ═══════════════════════════════════════════════════════════════════════
test('P20. stable config parameters are unchanged', () => {
  // Tuning in this task touches pitch-down support and eye eligibility only.
  // These are the values the engineering session validated; a change here
  // must be a deliberate decision, not a side effect.
  assert.equal(S.STRONG_YAW_DELTA_DEG, 25);
  assert.equal(S.YAW_PERSIST_MS, 1500);
  assert.equal(S.STRONG_UP_PITCH_DELTA_DEG, 30);
  assert.equal(S.PITCH_UP_PERSIST_MS, 2000);
  assert.equal(S.EAR_RELATIVE_THRESHOLD, 0.7);
  assert.equal(S.EYE_CLOSED_PERSIST_MS, 3000);
  assert.equal(S.ROLL_SUPPORT_DEG, 22);
  assert.equal(S.ROLL_SUPPORT_PERSIST_MS, 2000);
});

test('P21. D01 neutral stays clean', () => {
  assert.equal(judge('D01', window_(60)).trialVerdict, TrialVerdict.PASS);
});

test('P22. D02/D03 yaw semantics are unchanged', () => {
  const held = (sign) => window_(90, (i) => (i > 15
    ? { yawDelta: sign * (YAW + 8), yawEvidence: i > 60 } : {}));
  assert.equal(judge('D02', held(+1)).trialVerdict, TrialVerdict.PASS);
  assert.equal(judge('D03', held(-1)).trialVerdict, TrialVerdict.PASS);
  // Direction still matters for these two, unlike D04.
  assert.notEqual(judge('D02', held(-1)).trialVerdict, TrialVerdict.PASS);
  assert.notEqual(judge('D03', held(+1)).trialVerdict, TrialVerdict.PASS);
});

test('P23. D05 pitch-up semantics are unchanged', () => {
  const UP = S.STRONG_UP_PITCH_DELTA_DEG;
  assert.equal(judge('D05', window_(120, (i) => (i > 15
    ? { pitchDelta: UP + 5, pitchUpEvidence: i > 80 } : {}))).trialVerdict,
    TrialVerdict.PASS);
  assert.equal(judge('D05', window_(120, (i) => (i > 15
    ? { pitchDelta: UP + 5 } : {}))).trialVerdict, TrialVerdict.FAIL);
});

test('P24. D07 head tilt stays support-only', () => {
  const R = S.ROLL_SUPPORT_DEG;
  assert.equal(judge('D07', window_(120, (i) => (i > 15
    ? { rollDelta: R + 4, rollSupport: i > 50 } : {}))).trialVerdict,
    TrialVerdict.PASS);
  assert.equal(judge('D07', window_(120, (i) => (i > 15
    ? { rollDelta: R + 4, rollSupport: true, yawEvidence: i > 80 } : {})))
    .trialVerdict, TrialVerdict.FAIL);
});

test('P25. D08 normal blinking still does not latch closure', () => {
  const EAR = S.EAR_RELATIVE_THRESHOLD;
  assert.equal(judge('D08', window_(90, (i) => (i % 25 === 0
    ? { earRelative: EAR - 0.1 } : {}))).trialVerdict, TrialVerdict.PASS);
  assert.equal(judge('D08', window_(90, (i) => (i > 20
    ? { earRelative: EAR - 0.2, eyeClosureEvidence: i > 60 } : {})))
    .trialVerdict, TrialVerdict.FAIL);
});

test('P26. support evidence can never make a state diverted', () => {
  // The v0.2 guarantee, asserted against the real engine: reading, writing and
  // head tilt stay FOKUS however long the support cue persists.
  const e = new EvidenceEngine(CONFIG);
  for (const p of [{ pitchDownSupport: true },
                   { rollSupport: true },
                   { pitchDownSupport: true, rollSupport: true }]) {
    const r = e.decide(p);
    assert.equal(r.diverted, false, `${JSON.stringify(p)} must not divert`);
    assert.equal(r.primaryReason, 'NONE');
    assert.equal(r.strongCount, 0);
  }
  // And support never strengthens a strong decision either.
  const alone = e.decide({ yawStrong: true });
  const withSupport = e.decide({ yawStrong: true, pitchDownSupport: true,
    rollSupport: true });
  assert.equal(alone.diverted, withSupport.diverted);
  assert.equal(alone.strongCount, withSupport.strongCount);
  assert.equal(alone.primaryReason, withSupport.primaryReason);
});
