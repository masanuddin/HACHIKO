/**
 * Behavioral component freeze — the configuration DEVELOPMENT selected.
 *
 * These tests do NOT select anything. The values below were chosen during
 * Behavioral DEVELOPMENT and are frozen; this file exists so a later edit
 * that drifts one of them fails here rather than silently changing what the
 * product decides about a person.
 *
 * Two properties are asserted throughout:
 *   1. a threshold crossing alone is not evidence — persistence is required;
 *   2. SUPPORT evidence can never, by itself, produce TERALIH.
 *
 * Deterministic clock: every frame advances a fixed 33 ms, so nothing here
 * depends on wall time or frame scheduling.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { TemporalTracker } from '../src/ai/pipeline/TemporalTracker.js';
import { EvidenceEngine } from '../src/ai/pipeline/EvidenceEngine.js';
import { CONFIG } from '../src/ai/index.js';

const S = CONFIG.state;
const ELIG = CONFIG.eye.eligibility;
const FRAME_MS = 33;

/**
 * Hold one posture for `ms` and report what the engine concluded.
 *
 * Signals are fed as baseline-relative deltas, which is what the engine
 * consumes: a "pitch of -12" means 12° below THIS person's calibrated
 * neutral, never an absolute head angle.
 */
function hold({ ms, yaw = 0, pitch = 0, roll = 0, ear = 0.98, earAbs = 0.30 }) {
  const tracker = new TemporalTracker(CONFIG, new EvidenceEngine(CONFIG));
  const out = {
    frames: 0, eligibleFrames: 0,
    firstPitchDownMs: null, firstYawMs: null, firstPitchUpMs: null,
    firstEyeMs: null, last: null,
  };
  for (let now = FRAME_MS; now <= ms; now += FRAME_MS) {
    const r = tracker.update({
      facePresent: true, signalValid: true, poseValid: true,
      yawSmoothed: yaw, pitchSmoothed: pitch, rollSmoothed: roll,
      earSmoothed: ear,
      yawDelta: yaw, pitchDelta: pitch, rollDelta: roll, earRelative: ear,
      earLeft: earAbs, earRight: earAbs, earMean: earAbs,
    }, now);
    out.frames += 1;
    if (r.eyeEligible) out.eligibleFrames += 1;
    if (r.persisted.pitchDownSupport && out.firstPitchDownMs === null) out.firstPitchDownMs = now;
    if (r.persisted.yawStrong && out.firstYawMs === null) out.firstYawMs = now;
    if (r.persisted.pitchUpStrong && out.firstPitchUpMs === null) out.firstPitchUpMs = now;
    if (r.persisted.eyeClosureStrong && out.firstEyeMs === null) out.firstEyeMs = now;
    out.last = r;
  }
  return out;
}

/** What StateEngine's fusion would conclude from a persisted-evidence set. */
const decide = (persisted) => new EvidenceEngine(CONFIG).decide(persisted);

// ═══════════════════════════════════════════════════════════════════════
// §2 — the frozen values themselves
// ═══════════════════════════════════════════════════════════════════════
test('F1. the behavioral configuration is exactly the frozen set', () => {
  assert.equal(S.STRONG_YAW_DELTA_DEG, 25);
  assert.equal(S.YAW_PERSIST_MS, 1500);
  assert.equal(S.STRONG_UP_PITCH_DELTA_DEG, 30);
  assert.equal(S.PITCH_UP_PERSIST_MS, 2000);
  assert.equal(S.DOWN_PITCH_SUPPORT_DEG, 10);
  assert.equal(S.DOWN_PITCH_SUPPORT_PERSIST_MS, 2000);
  assert.equal(S.ROLL_SUPPORT_DEG, 22);
  assert.equal(S.ROLL_SUPPORT_PERSIST_MS, 2000);
  assert.equal(S.EAR_RELATIVE_THRESHOLD, 0.70);
  assert.equal(S.EYE_CLOSED_PERSIST_MS, 3000);
  assert.equal(ELIG.EYE_MAX_ABS_PITCH_DEG, 10);
  assert.equal(ELIG.EYE_MAX_ABS_YAW_DEG, 20);
  assert.equal(ELIG.EYE_MAX_LR_RATIO, 1.6);
});

// ═══════════════════════════════════════════════════════════════════════
// §9 — pitch-down: threshold, persistence, and SUPPORT-ONLY status
// ═══════════════════════════════════════════════════════════════════════
test('F2. pitch-down under 10° never persists as support', () => {
  // Shallower than the frozen threshold, held far longer than the window.
  for (const deg of [4, 8, 9.5]) {
    const r = hold({ ms: 6000, pitch: -deg });
    assert.equal(r.firstPitchDownMs, null,
      `${deg}° must not become support evidence`);
  }
});

test('F3. pitch-down over 10° held under 2000 ms does not persist', () => {
  const r = hold({ ms: 1800, pitch: -14 });
  assert.equal(r.firstPitchDownMs, null,
    'crossing the threshold is not evidence; persistence is required');
});

test('F4. pitch-down over 10° held past 2000 ms becomes support', () => {
  const r = hold({ ms: 4000, pitch: -14 });
  assert.ok(r.firstPitchDownMs !== null, 'support must activate');
  assert.ok(r.firstPitchDownMs >= S.DOWN_PITCH_SUPPORT_PERSIST_MS,
    `must not latch early: fired at ${r.firstPitchDownMs}ms`);
  assert.ok(r.firstPitchDownMs <= S.DOWN_PITCH_SUPPORT_PERSIST_MS + 5 * FRAME_MS,
    'and must not need far longer than the configured window');
});

test('F5. pitch-down support ALONE never produces TERALIH', () => {
  // The whole point of the support tier. A person reading their notes is
  // studying, not distracted.
  const d = decide({ pitchDownSupport: true });
  assert.equal(d.diverted, false, 'support alone must not divert');
  assert.equal(d.strongCount, 0);
  assert.equal(d.supportCount, 1, 'but it IS recorded as context');
  assert.equal(d.activeEvidence.pitchDownSupport, true);

  // Even both support channels together remain non-diverting.
  const both = decide({ pitchDownSupport: true, rollSupport: true });
  assert.equal(both.diverted, false);
  assert.equal(both.supportCount, 2);
});

test('F6. head-tilt support is unchanged and also cannot divert alone', () => {
  const r = hold({ ms: 4000, roll: 26 });
  assert.ok(r.last.persisted.rollSupport, 'roll support activates at 22°');
  assert.equal(decide({ rollSupport: true }).diverted, false);
});

// ═══════════════════════════════════════════════════════════════════════
// §9 — eye eligibility: the reading/writing false-positive guard
// ═══════════════════════════════════════════════════════════════════════
test('F7. eye closure is eligible while |pitch| <= 10°', () => {
  const r = hold({ ms: 5000, pitch: -8, ear: 0.40, earAbs: 0.12 });
  assert.ok(r.eligibleFrames > 0, 'a near-level head keeps the eye signal usable');
  assert.ok(r.firstEyeMs !== null, 'and closure can be detected');
});

test('F8. eye closure CANNOT accumulate while |pitch| > 10°', () => {
  // The false positive this guards: head-down reading foreshortens the lid,
  // EAR collapses, and the engine would otherwise call it a closed eye.
  for (const deg of [12, 18, 25]) {
    const r = hold({ ms: 8000, pitch: -deg, ear: 0.35, earAbs: 0.10 });
    assert.equal(r.eligibleFrames, 0, `${deg}° down must be ineligible`);
    assert.equal(r.firstEyeMs, null,
      `${deg}° down must not accumulate prolonged-closure evidence`);
    assert.equal(r.last.persisted.eyeClosureStrong, false);
  }
});

test('F9. the boundary is enforced at 10°, not near it', () => {
  // Just inside stays usable; just outside abstains. A boundary that drifts
  // silently is how a guard stops guarding.
  const inside = hold({ ms: 5000, pitch: -9.5, ear: 0.40, earAbs: 0.12 });
  const outside = hold({ ms: 5000, pitch: -10.5, ear: 0.40, earAbs: 0.12 });
  assert.ok(inside.eligibleFrames > 0, '9.5° down is still eligible');
  assert.equal(outside.eligibleFrames, 0, '10.5° down is not');
});

test('F10. sustained closure with an eligible pose still fires after 3000 ms', () => {
  // Tightening eligibility must not cost the engine a real closure.
  const r = hold({ ms: 6000, pitch: -3, ear: 0.40, earAbs: 0.12 });
  assert.ok(r.firstEyeMs !== null, 'a real sustained closure must be detected');
  assert.ok(r.firstEyeMs >= S.EYE_CLOSED_PERSIST_MS,
    `must not latch before ${S.EYE_CLOSED_PERSIST_MS}ms, fired at ${r.firstEyeMs}ms`);
});

// ═══════════════════════════════════════════════════════════════════════
// §9 — strong channels
// ═══════════════════════════════════════════════════════════════════════
test('F11. strong yaw needs 25° AND 1500 ms', () => {
  assert.equal(hold({ ms: 6000, yaw: 22 }).firstYawMs, null,
    'under threshold never fires');
  assert.equal(hold({ ms: 1300, yaw: 30 }).firstYawMs, null,
    'over threshold but under the window never fires');

  const r = hold({ ms: 4000, yaw: 30 });
  assert.ok(r.firstYawMs >= S.YAW_PERSIST_MS,
    `fired at ${r.firstYawMs}ms, must be >= ${S.YAW_PERSIST_MS}`);
  // Yaw IS strong: once persisted it may divert on its own.
  assert.equal(decide({ yawStrong: true }).diverted, true);
});

test('F12. yaw is non-directional — either side is equally diverting', () => {
  for (const sign of [+1, -1]) {
    const r = hold({ ms: 4000, yaw: sign * 30 });
    assert.ok(r.firstYawMs !== null, `yaw ${sign > 0 ? 'left' : 'right'} must fire`);
  }
});

test('F13. strong pitch-up needs 30° AND 2000 ms', () => {
  assert.equal(hold({ ms: 6000, pitch: +26 }).firstPitchUpMs, null,
    'under threshold never fires');
  assert.equal(hold({ ms: 1800, pitch: +35 }).firstPitchUpMs, null,
    'over threshold but under the window never fires');

  const r = hold({ ms: 5000, pitch: +35 });
  assert.ok(r.firstPitchUpMs >= S.PITCH_UP_PERSIST_MS,
    `fired at ${r.firstPitchUpMs}ms, must be >= ${S.PITCH_UP_PERSIST_MS}`);
  assert.equal(decide({ pitchUpStrong: true }).diverted, true);
});

test('F14. pitch is directional — down is never read as up', () => {
  // The asymmetry is the whole point: looking up is disengagement, looking
  // down is usually the work itself.
  const down = hold({ ms: 5000, pitch: -35 });
  assert.equal(down.firstPitchUpMs, null, 'a deep look-down is not pitch-up');
  assert.ok(down.firstPitchDownMs !== null, 'it is pitch-down support');
  assert.equal(decide(down.last.persisted).diverted, false,
    'and therefore does not divert');
});

// ═══════════════════════════════════════════════════════════════════════
// §7 — reading / writing, end to end
// ═══════════════════════════════════════════════════════════════════════
test('F15. natural reading posture yields support, never TERALIH', () => {
  // A realistic head-down reading pose with a low EAR: exactly the posture
  // that used to produce a false sustained eye closure.
  const r = hold({ ms: 15000, pitch: -16, roll: 6, ear: 0.62, earAbs: 0.18 });

  assert.ok(r.firstPitchDownMs !== null,
    'pitch-down support SHOULD activate — that is not a false positive');
  assert.equal(r.eligibleFrames, 0,
    'the eye channel must abstain at this head angle');
  assert.equal(r.firstEyeMs, null,
    'and must never accumulate prolonged-closure evidence');

  const d = decide(r.last.persisted);
  assert.equal(d.diverted, false, 'reading must not be TERALIH');
  assert.equal(d.strongCount, 0, 'no strong evidence may be fabricated');
  assert.ok(d.supportCount >= 1, 'the posture is still recorded as context');
});

// ═══════════════════════════════════════════════════════════════════════
// §4 — StateEngine remains the single behavioral authority
// ═══════════════════════════════════════════════════════════════════════
test('F16. only strong channels can divert; support is never consulted', () => {
  // Reading the fusion directly: whatever the support flags say, `diverted`
  // must follow the strong set alone.
  for (const support of [{}, { pitchDownSupport: true },
    { rollSupport: true }, { pitchDownSupport: true, rollSupport: true }]) {
    assert.equal(decide({ ...support }).diverted, false);
    assert.equal(decide({ ...support, yawStrong: true }).diverted, true);
  }
  // And each strong channel can stand alone.
  for (const k of ['yawStrong', 'pitchUpStrong', 'eyeClosureStrong']) {
    assert.equal(decide({ [k]: true }).diverted, true, `${k} is strong`);
  }
});

test('F17. no new public behavioral state was introduced', async () => {
  const { AIState } = await import('../src/ai/index.js');
  assert.deepEqual(Object.values(AIState).sort(),
    ['FOKUS', 'TERALIH', 'TIDAK_HADIR'].sort(),
    'the three public states are fixed');
  // AMBIGUOUS and INVALID/UNRELIABLE remain INTERNAL interpretations of
  // signal quality; they must never surface as a behavioral state.
  for (const banned of ['MENGANTUK', 'UNCERTAIN', 'WAKTU_BELUM_JELAS',
    'AMBIGUOUS', 'INVALID', 'UNRELIABLE']) {
    assert.ok(!Object.values(AIState).includes(banned),
      `${banned} must not be a public behavioral state`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// §8 — debug exporter: completion means EVALUABLE, not attempted
// ═══════════════════════════════════════════════════════════════════════
test('F18. three INVALID attempts do not complete a scenario', async () => {
  const { DebugSession } = await import('../tools/debug/DebugSession.js');
  const { getScenarioByCode } = await import('../tools/debug/scenarios.js');
  const CAL = { status: 'VALID', valid: true, capturedAtIso: 'x',
    baseline: { yaw: 0, pitch: 0, roll: 0, ear: 0.4, sampleCount: 150 } };

  const session = new DebugSession();
  const sc = getScenarioByCode('D06');
  // No samples => nothing judgeable => INVALID. Completion used to count
  // these, reporting a finished protocol built on no evidence at all.
  for (let i = 0; i < 3; i++) {
    const ref = session.nextTrialRef(sc.id);
    session.addTrial({ trialId: ref.trialId, scenario: sc.id,
      repetition: ref.repetition, recordingDurationMs: 5000,
      sampleCount: 0, samples: [] }, sc, CAL);
  }

  const p = session.buildResultsJson({}).progress;
  assert.equal(p.scenariosComplete, 0, 'INVALID attempts complete nothing');
  assert.equal(p.totalAttempts, 3);
  assert.equal(p.totalEvaluableTrials, 0);
  assert.equal(p.totalInvalidTrials, 3);
  assert.equal(p.totalAttempts,
    p.totalEvaluableTrials + p.totalInvalidTrials,
    'attempts = evaluable + invalid');
  // The legacy field keeps its historical meaning for existing consumers.
  assert.equal(p.totalValidTrials, 3, 'unchanged: every saved attempt');
});

test('F19. D06 and D11 stay distinct, and D06 sources the frozen threshold', async () => {
  const { getScenarioByCode } = await import('../tools/debug/scenarios.js');
  const d06 = getScenarioByCode('D06');
  const d11 = getScenarioByCode('D11');

  // D06 is the CONTROLLED support-rule test; D11 the natural guardrail.
  assert.notEqual(d06.id, d11.id);
  assert.equal(d06.id, 'PITCH_DOWN_STUDY_LIKE');
  assert.equal(d11.id, 'READING_WRITING');
  // Both must state that pitch-down cannot create TERALIH on its own.
  for (const sc of [d06, d11]) {
    assert.equal(sc.triggerExpected, false, `${sc.code} expects no trigger`);
  }

  // D06's recording window must outlast the frozen persistence, or the
  // support cue it tests could never accumulate inside the trial.
  assert.ok(d06.recordingDurationMs > S.DOWN_PITCH_SUPPORT_PERSIST_MS,
    'D06 must be long enough for support to persist');
});

test('F20. the D06 challenge criterion derives from config, not a literal', async () => {
  const src = await import('node:fs')
    .then((fs) => fs.readFileSync(
      new URL('../tools/debug/evaluateDebugTrial.js', import.meta.url), 'utf8'));
  const block = src.slice(src.indexOf("case 'PITCH_DOWN_STUDY_LIKE'"),
    src.indexOf("case 'HEAD_TILT'"));
  assert.match(block, /S\.DOWN_PITCH_SUPPORT_DEG/,
    'the criterion must follow the frozen threshold');
  assert.ok(!/25/.test(block),
    'no hardcoded 25° may survive the freeze');
});
