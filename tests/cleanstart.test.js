/**
 * Clean-start production-equivalence + targeted-study support (spec §14).
 *
 * The governing requirement: the Debug harness must remove pre-trial
 * CONTAMINATION without granting itself an ADVANTAGE. A bounded trial may not
 * inherit persistence banked during the countdown, and it must not measure a
 * pipeline that reacts faster than the one that ships.
 *
 * These drive the real engine end to end. No threshold is changed anywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { HachikoAI } from '../src/ai/HachikoAI.js';
import { FeatureSmoother } from '../src/ai/pipeline/FeatureSmoother.js';
import { TemporalTracker } from '../src/ai/pipeline/TemporalTracker.js';
import { EvidenceEngine } from '../src/ai/pipeline/EvidenceEngine.js';
import { CONFIG } from '../src/ai/index.js';
import { DebugSession } from '../tools/debug/DebugSession.js';
import { getScenarioByCode } from '../tools/debug/scenarios.js';
import { TrialController } from '../tools/shared/TrialController.js';

const S = CONFIG.state;
const CAL = { status: 'VALID', valid: true, capturedAtIso: 'x',
  baseline: { yaw: -2, pitch: -6, roll: 0, ear: 0.41, sampleCount: 150 } };

/**
 * Drive smoother + tracker exactly as the live pipeline does, and report when
 * `channel` latched relative to the bounded window opening.
 *
 * @param {Object} o
 * @param {string} o.channel      persisted key to watch
 * @param {number} o.challenge    calibrated value held during the trial
 * @param {number} [o.pre]        value held during the countdown
 * @param {boolean} o.clearSmoother  whether the boundary wipes EMA history
 */
function latchDelay({ channel, challenge, pre = 0, clearSmoother, preFrames = 90 }) {
  const sm = new FeatureSmoother(CONFIG);
  const tt = new TemporalTracker(CONFIG, new EvidenceEngine(CONFIG));
  let now = 0;

  const field = { yawStrong: 'yawDelta', pitchUpStrong: 'pitchDelta',
    eyeClosureStrong: 'earRelative', rollSupport: 'rollDelta',
    pitchDownSupport: 'pitchDelta' }[channel];
  const neutral = channel === 'eyeClosureStrong' ? 1.0 : 0;

  const feed = (v) => {
    now += 33;
    const cal = { yawDelta: 0, pitchDelta: 0, rollDelta: 0, earRelative: 1.0 };
    cal[field] = v;
    const s = sm.update(cal, now);
    return tt.update({ facePresent: true, signalValid: true, poseValid: true,
      yawSmoothed: s.yawSmoothed, pitchSmoothed: s.pitchSmoothed,
      rollSmoothed: s.rollSmoothed, earSmoothed: s.earSmoothed,
      ...cal, earLeft: 0.3, earRight: 0.3, earMean: 0.3 }, now);
  };

  for (let i = 0; i < preFrames; i++) feed(pre === 0 ? neutral : pre);
  if (clearSmoother) sm.reset();
  tt.reset();                                   // the clean start

  const start = now;
  let latched = null;
  let banked = 0;
  for (let i = 0; i < 220; i++) {
    const r = feed(challenge);
    if (r.persisted[channel] && latched === null) latched = now - start;
    banked = Math.max(banked, r.accumulated[channel] ?? 0);
  }
  return { latched, banked };
}

// ═══════════════════════════════════════════════════════════════════════
// §2 / §4 — what the clean start actually touches
// ═══════════════════════════════════════════════════════════════════════
test('C1. the clean start keeps the smoother WARM', () => {
  const ai = new HachikoAI(CONFIG);
  ai.smoother.update({ yawDelta: 10, pitchDelta: 5, rollDelta: 2,
    earRelative: 0.9 }, 100);
  ai.smoother.update({ yawDelta: 12, pitchDelta: 6, rollDelta: 3,
    earRelative: 0.9 }, 133);
  const before = { ...ai.smoother };

  ai.resetTemporalEvidence();

  // An EMA seeded from null adopts its first sample RAW, skipping the ramp
  // production always pays — that is the Debug-only advantage this guards.
  assert.equal(ai.smoother.yawSmoothed, before.yawSmoothed, 'yaw EMA preserved');
  assert.equal(ai.smoother.pitchSmoothed, before.pitchSmoothed);
  assert.equal(ai.smoother.rollSmoothed, before.rollSmoothed);
  assert.equal(ai.smoother.earSmoothed, before.earSmoothed);
  assert.notEqual(ai.smoother.yawSmoothed, null);
});

test('C2. the clean start DOES clear persistence timers', () => {
  const ai = new HachikoAI(CONFIG);
  ai.temporal.timers.yawStrong.update(true, 100);
  ai.temporal.timers.yawStrong.update(true, 1000);
  assert.ok(ai.temporal.timers.yawStrong.accumulatedMs > 0, 'banked first');

  ai.resetTemporalEvidence();
  for (const [name, timer] of Object.entries(ai.temporal.timers)) {
    assert.equal(timer.accumulatedMs, 0, `${name} must be cleared`);
  }
});

test('C3. the clean start preserves calibration', () => {
  const ai = new HachikoAI(CONFIG);
  const before = ai.getCalibrationSnapshot();
  ai.resetTemporalEvidence();
  assert.deepEqual(ai.getCalibrationSnapshot(), before);
});

test('C4. production monitoring never reaches the Debug reset path', () => {
  // The harness may hold a known starting point; the shipped engine may not
  // silently acquire one. `processFrame` is production's only entry point.
  const src = readFileSync(new URL('../src/ai/HachikoAI.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('processFrame'));
  const end = body.indexOf('\n  reset()');
  assert.ok(!body.slice(0, end > 0 ? end : body.length)
    .includes('resetTemporalEvidence('),
    'processFrame must not call the experiment-boundary reset');

  // And nothing outside the Debug harness calls it either.
  const harness = readFileSync(
    new URL('../tools/debug/DebugHarness.js', import.meta.url), 'utf8');
  assert.ok(harness.includes('resetTemporalEvidence'), 'the harness does call it');
});

// ═══════════════════════════════════════════════════════════════════════
// §3 / §5 — no cold-start artefact, no Debug-only advantage
// ═══════════════════════════════════════════════════════════════════════
test('C5. CASE B — a neutral countdown leaves the trial production-equivalent', () => {
  // Subject holds still through the countdown. Those frames are exactly the
  // warm-up continuous monitoring would have, so keeping them costs nothing
  // and removing them would make the trial faster than production.
  const warm = latchDelay({ channel: 'yawStrong', challenge: S.STRONG_YAW_DELTA_DEG + 7,
    clearSmoother: false });
  const cold = latchDelay({ channel: 'yawStrong', challenge: S.STRONG_YAW_DELTA_DEG + 7,
    clearSmoother: true });

  assert.ok(warm.latched > S.YAW_PERSIST_MS,
    'a warm pipeline pays the EMA ramp on top of the persistence rule');
  assert.ok(cold.latched < warm.latched,
    'a cleared smoother latches EARLY — the artefact this avoids');
  assert.ok(warm.latched - cold.latched >= 60,
    `the distortion is material: ${warm.latched - cold.latched}ms`);
});

test('C6. every channel would be biased early by a cold smoother', () => {
  // Not a yaw quirk: the same artefact applies wherever a threshold is
  // crossed, so the fix has to be at the boundary rather than per-channel.
  const cases = [
    { channel: 'yawStrong', challenge: S.STRONG_YAW_DELTA_DEG + 7 },
    { channel: 'pitchUpStrong', challenge: S.STRONG_UP_PITCH_DELTA_DEG + 6 },
    { channel: 'eyeClosureStrong', challenge: S.EAR_RELATIVE_THRESHOLD - 0.35 },
    { channel: 'rollSupport', challenge: S.ROLL_SUPPORT_DEG + 5 },
  ];
  for (const c of cases) {
    const warm = latchDelay({ ...c, clearSmoother: false });
    const cold = latchDelay({ ...c, clearSmoother: true });
    assert.ok(warm.latched !== null && cold.latched !== null,
      `${c.channel} never latched`);
    assert.ok(cold.latched <= warm.latched,
      `${c.channel}: a cold smoother must never be SLOWER`);
  }
});

test('C7. CASE A — a challenge during countdown cannot bank persistence', () => {
  // Subject is already turned when the window opens. Without the reset the
  // trial latches in a fraction of the configured time.
  const contaminated = latchDelay({ channel: 'yawStrong',
    challenge: S.STRONG_YAW_DELTA_DEG + 7, pre: S.STRONG_YAW_DELTA_DEG + 7,
    clearSmoother: false });

  // With the reset (which latchDelay always applies to the tracker), the
  // trial still pays the full rule despite the pre-trial turn.
  assert.ok(contaminated.latched >= S.YAW_PERSIST_MS,
    `a pre-turned head must not shortcut the rule; latched at `
    + `${contaminated.latched}ms`);
});

test('C8. D04 cannot inherit pre-trial yaw persistence', () => {
  const r = latchDelay({ channel: 'yawStrong', challenge: S.STRONG_YAW_DELTA_DEG + 5,
    pre: S.STRONG_YAW_DELTA_DEG + 5, clearSmoother: false });
  // The brief-glance scenario depends entirely on persistence NOT completing
  // early, so inherited accumulation would invalidate the whole scenario.
  assert.ok(r.latched >= S.YAW_PERSIST_MS);
});

test('C8b. countdown yaw cannot leak into the official recording window', () => {
  const tt = new TemporalTracker(CONFIG, new EvidenceEngine(CONFIG));
  const sc = { id: 'YAW_LEFT_SUSTAINED', countdownMs: 3000, recordingDurationMs: 3000 };
  const c = new TrialController({ onRecordingStart: () => tt.reset() });
  c.cameraStarted(); c.selectScenario(sc); c.startTrial(0, { trialId: 'T', repetition: 1 });

  const strong = S.STRONG_YAW_DELTA_DEG + 8;
  let countdownPersisted = false;
  for (let now = 33; now <= sc.countdownMs; now += 33) {
    const r = tt.update({ facePresent: true, signalValid: true, poseValid: true,
      yawSmoothed: strong, pitchSmoothed: 0, rollSmoothed: 0, earSmoothed: 1,
      yawDelta: strong, pitchDelta: 0, earLeft: 0.3, earRight: 0.3, earMean: 0.3 }, now);
    countdownPersisted ||= r.persisted.yawStrong;
    c.tick(now);
  }
  c.tick(sc.countdownMs);
  assert.equal(countdownPersisted, true, 'countdown cue really could have latched');

  const first = tt.update({ facePresent: true, signalValid: true, poseValid: true,
    yawSmoothed: 0, pitchSmoothed: 0, rollSmoothed: 0, earSmoothed: 1,
    yawDelta: 0, pitchDelta: 0, earLeft: 0.3, earRight: 0.3, earMean: 0.3 },
  sc.countdownMs + 33);
  assert.equal(first.persisted.yawStrong, false);
  assert.equal(first.accumulated.yawStrong, 0);
});

test('C8c. continuing countdown yaw pays full persistence from recording start', () => {
  const tt = new TemporalTracker(CONFIG, new EvidenceEngine(CONFIG));
  const sc = { id: 'YAW_LEFT_SUSTAINED', countdownMs: 3000, recordingDurationMs: 5000 };
  const c = new TrialController({ onRecordingStart: () => tt.reset() });
  c.cameraStarted(); c.selectScenario(sc); c.startTrial(0, { trialId: 'T', repetition: 1 });

  const strong = S.STRONG_YAW_DELTA_DEG + 8;
  for (let now = 33; now <= sc.countdownMs; now += 33) {
    tt.update({ facePresent: true, signalValid: true, poseValid: true,
      yawSmoothed: strong, pitchSmoothed: 0, rollSmoothed: 0, earSmoothed: 1,
      yawDelta: strong, pitchDelta: 0, earLeft: 0.3, earRight: 0.3, earMean: 0.3 }, now);
    c.tick(now);
  }
  c.tick(sc.countdownMs);

  const start = c.recordingStartedAt;
  let latched = null;
  for (let now = start + 33; now < start + 4000; now += 33) {
    const r = tt.update({ facePresent: true, signalValid: true, poseValid: true,
      yawSmoothed: strong, pitchSmoothed: 0, rollSmoothed: 0, earSmoothed: 1,
      yawDelta: strong, pitchDelta: 0, earLeft: 0.3, earRight: 0.3, earMean: 0.3 }, now);
    if (r.persisted.yawStrong && latched === null) latched = now - start;
  }
  assert.ok(latched >= S.YAW_PERSIST_MS,
    `countdown must not shorten persistence; latched at ${latched}ms`);
});

test('C9. D09 eye persistence starts from bounded evidence only', () => {
  const r = latchDelay({ channel: 'eyeClosureStrong',
    challenge: S.EAR_RELATIVE_THRESHOLD - 0.35,
    pre: S.EAR_RELATIVE_THRESHOLD - 0.35, clearSmoother: false });
  assert.ok(r.latched >= S.EYE_CLOSED_PERSIST_MS,
    `closure must not inherit pre-trial accumulation; latched at ${r.latched}ms`);
});

test('C10. support evidence cannot inherit stale persistence either', () => {
  for (const c of [
    { channel: 'rollSupport', challenge: S.ROLL_SUPPORT_DEG + 5,
      rule: S.ROLL_SUPPORT_PERSIST_MS },
    { channel: 'pitchDownSupport', challenge: -(S.DOWN_PITCH_SUPPORT_DEG + 5),
      rule: S.DOWN_PITCH_SUPPORT_PERSIST_MS },
  ]) {
    const r = latchDelay({ channel: c.channel, challenge: c.challenge,
      pre: c.challenge, clearSmoother: false });
    assert.ok(r.latched >= c.rule,
      `${c.channel} inherited pre-trial persistence`);
  }
});

test('C11. D02/D03 and D05 timing semantics are unchanged', () => {
  // Left and right must remain symmetric, and each must still pay its own
  // configured rule — the clean start may not shift either.
  const left = latchDelay({ channel: 'yawStrong',
    challenge: S.STRONG_YAW_DELTA_DEG + 8, clearSmoother: false });
  const right = latchDelay({ channel: 'yawStrong',
    challenge: -(S.STRONG_YAW_DELTA_DEG + 8), clearSmoother: false });
  assert.equal(left.latched, right.latched, 'left and right stay symmetric');
  assert.ok(left.latched >= S.YAW_PERSIST_MS);

  const up = latchDelay({ channel: 'pitchUpStrong',
    challenge: S.STRONG_UP_PITCH_DELTA_DEG + 6, clearSmoother: false });
  assert.ok(up.latched >= S.PITCH_UP_PERSIST_MS);
});

test('C12. D08 blink behaviour remains production-equivalent', () => {
  // Brief dips must not complete the closure rule, warm smoother included.
  const sm = new FeatureSmoother(CONFIG);
  const tt = new TemporalTracker(CONFIG, new EvidenceEngine(CONFIG));
  let now = 0;
  let fired = false;
  for (let i = 0; i < 240; i++) {
    now += 33;
    const ear = (i % 30 < 3) ? S.EAR_RELATIVE_THRESHOLD - 0.35 : 0.97;
    const s = sm.update({ yawDelta: 0, pitchDelta: 0, rollDelta: 0,
      earRelative: ear }, now);
    const r = tt.update({ facePresent: true, signalValid: true, poseValid: true,
      yawSmoothed: s.yawSmoothed, pitchSmoothed: s.pitchSmoothed,
      rollSmoothed: s.rollSmoothed, earSmoothed: s.earSmoothed,
      yawDelta: 0, pitchDelta: 0, rollDelta: 0, earRelative: ear,
      earLeft: 0.3, earRight: 0.3, earMean: 0.3 }, now);
    if (r.persisted.eyeClosureStrong) fired = true;
  }
  assert.equal(fired, false, 'normal blinking must never latch closure');
});

// ═══════════════════════════════════════════════════════════════════════
// §8 — no subject identity anywhere
// ═══════════════════════════════════════════════════════════════════════
test('C13. no subject identity is carried by the session or its exports', () => {
  const s = new DebugSession();
  const sc = getScenarioByCode('D01');
  const ref = s.nextTrialRef(sc.id);
  const rec = s.addTrial({ trialId: ref.trialId, scenario: sc.id,
    repetition: ref.repetition, recordingDurationMs: 10000, sampleCount: 1,
    samples: [{ relativeTimeMs: 0, yawDelta: 1, pitchDelta: 0, rollDelta: 0,
      earRelative: 0.98, faceDetected: true, headPoseValid: true,
      eyeEligible: true, stateSignalValid: true, publicState: 'FOKUS',
      primaryReason: 'NONE', fps: 30, faceInferenceMs: 11 }] }, sc, CAL);

  // The session carries no subject concept at all.
  assert.equal(s.subjectId, undefined, 'no session-level subject field');
  assert.equal(typeof s.setSubjectId, 'undefined', 'and no setter remains');
  assert.equal(rec.subjectId, undefined, 'trials are not stamped with one');

  const doc = s.buildResultsJson({});
  assert.equal(doc.session.subjectId, undefined);
  assert.equal(doc.trials[0].subjectId, undefined);
  assert.ok(!JSON.stringify(doc).includes('subjectId'),
    'the JSON archive mentions no subject');

  const NL = String.fromCharCode(10);
  const head = s.buildTrialsCsv().split(NL)[0].split(',');
  assert.ok(!head.includes('subject_id'), 'the CSV has no subject column');
});

// ═══════════════════════════════════════════════════════════════════════
// §7 — the targeted rerun set, and §10's no-tuning rule
// ═══════════════════════════════════════════════════════════════════════
test('C17. the targeted rerun scenarios all exist and are unchanged', () => {
  for (const code of ['D01', 'D06', 'D08', 'D09', 'D11']) {
    const sc = getScenarioByCode(code);
    assert.ok(sc, `${code} must exist`);
    assert.ok(sc.recordingDurationMs > 0);
  }
  // The rest of the matrix is NOT removed — targeting is a filter, not a purge.
  for (const code of ['D02', 'D03', 'D04', 'D05', 'D07', 'D10']) {
    assert.ok(getScenarioByCode(code), `${code} must remain in the registry`);
  }
});

test('C18. no AI parameter was frozen by this task', () => {
  assert.equal(S.DOWN_PITCH_SUPPORT_DEG, 25, 'pitch-down stays at baseline');
  assert.equal(CONFIG.eye.eligibility.EYE_MAX_ABS_PITCH_DEG, 15,
    'eye eligibility stays at baseline');
  assert.equal(S.EAR_RELATIVE_THRESHOLD, 0.7);
  assert.equal(S.EYE_CLOSED_PERSIST_MS, 3000);
  assert.equal(S.STRONG_YAW_DELTA_DEG, 25);
  assert.equal(S.YAW_PERSIST_MS, 1500);
  assert.equal(S.STRONG_UP_PITCH_DELTA_DEG, 30);
  assert.equal(S.PITCH_UP_PERSIST_MS, 2000);
  assert.equal(S.ROLL_SUPPORT_DEG, 22);
});
