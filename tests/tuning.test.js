/**
 * Parameter-candidate comparisons (spec §7, §12, §19).
 *
 * These tests SELECT NOTHING. They hold the comparison machinery honest:
 *   - candidates are evaluated against the real engine under an injected
 *     config, never by mutating the shared baseline,
 *   - the baseline values stay reproducible as comparison points,
 *   - the conclusions the report rests on are asserted, so a later change to
 *     the engine that invalidates them fails here rather than silently.
 *
 * Traces are synthetic, shaped to the ranges the pilot session observed. They
 * are a candidate FILTER (Stage A), not validation evidence: nothing here
 * justifies freezing a parameter on its own.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { TemporalTracker } from '../src/ai/pipeline/TemporalTracker.js';
import { EvidenceEngine } from '../src/ai/pipeline/EvidenceEngine.js';
import { CONFIG } from '../src/ai/index.js';

/** A config with one threshold overridden. The baseline object is untouched. */
function withCfg(over = {}) {
  return {
    ...CONFIG,
    state: { ...CONFIG.state, ...(over.state ?? {}) },
    eye: { ...CONFIG.eye,
      eligibility: { ...CONFIG.eye.eligibility, ...(over.eyeEligibility ?? {}) } },
  };
}

/** Replay a posture trace through the real engine. Returns facts, no verdict. */
function replay(cfg, frames) {
  const t = new TemporalTracker(cfg, new EvidenceEngine(cfg));
  let now = 0;
  const out = { pitchDownMs: 0, rollMs: 0, eyeMs: 0, yawMs: 0, pitchUpMs: 0,
    eligibleFrames: 0, frames: 0, firstEyeMs: null };
  for (const f of frames) {
    now += 33;
    const r = t.update({
      facePresent: true, signalValid: true, poseValid: true,
      yawSmoothed: f.yaw, pitchSmoothed: f.pitch, rollSmoothed: f.roll,
      earSmoothed: f.ear,
      yawDelta: f.yaw, pitchDelta: f.pitch, rollDelta: f.roll, earRelative: f.ear,
      earLeft: f.earAbs ?? 0.30, earRight: f.earAbs ?? 0.30,
      earMean: f.earAbs ?? 0.30,
    }, now);
    out.frames += 1;
    if (r.persisted.pitchDownSupport) out.pitchDownMs += 33;
    if (r.persisted.rollSupport) out.rollMs += 33;
    if (r.persisted.yawStrong) out.yawMs += 33;
    if (r.persisted.pitchUpStrong) out.pitchUpMs += 33;
    if (r.persisted.eyeClosureStrong) {
      out.eyeMs += 33;
      if (out.firstEyeMs === null) out.firstEyeMs = now;
    }
    if (r.eyeEligible) out.eligibleFrames += 1;
  }
  return out;
}

const jit = (i, a) => a * Math.sin(i / 7);
const N = 210;

// Traces shaped to the pilot's observed ranges.
const neutral = () => Array.from({ length: N }, (_, i) =>
  ({ yaw: jit(i, 2), pitch: jit(i, 3), roll: jit(i, 1.5), ear: 0.98 }));
const studyDown = (deg) => Array.from({ length: N }, (_, i) =>
  ({ yaw: jit(i, 2), pitch: -(deg + jit(i, 0.8)), roll: jit(i, 2), ear: 0.95 }));
const eyesClosed = (pitchDeg = 0) => Array.from({ length: N }, (_, i) =>
  ({ yaw: jit(i, 2), pitch: -(pitchDeg + jit(i, 1.2)), roll: jit(i, 1.5),
     ear: i > 6 ? 0.35 : 0.95, earAbs: i > 6 ? 0.10 : 0.30 }));
const reading = (pitchDeg) => Array.from({ length: N }, (_, i) =>
  ({ yaw: jit(i, 4), pitch: -(pitchDeg + 1.5 * Math.sin(i / 13)),
     roll: 6 + jit(i, 4), ear: 0.62 + 0.05 * Math.sin(i / 9), earAbs: 0.18 }));
const blinks = () => Array.from({ length: N }, (_, i) =>
  ({ yaw: jit(i, 2), pitch: jit(i, 2.5), roll: jit(i, 1.5),
     ear: (i % 30 < 3) ? 0.35 : 0.97, earAbs: (i % 30 < 3) ? 0.10 : 0.30 }));

// ═══════════════════════════════════════════════════════════════════════
// Machinery integrity — the comparisons must not corrupt the baseline
// ═══════════════════════════════════════════════════════════════════════
test('U1. candidate evaluation never mutates the shared config', () => {
  const beforeDown = CONFIG.state.DOWN_PITCH_SUPPORT_DEG;
  const beforePitch = CONFIG.eye.eligibility.EYE_MAX_ABS_PITCH_DEG;

  for (const deg of [10, 15, 18, 20, 25]) {
    replay(withCfg({ state: { DOWN_PITCH_SUPPORT_DEG: deg } }), studyDown(16));
    replay(withCfg({ eyeEligibility: { EYE_MAX_ABS_PITCH_DEG: deg } }), eyesClosed());
  }

  assert.equal(CONFIG.state.DOWN_PITCH_SUPPORT_DEG, beforeDown);
  assert.equal(CONFIG.eye.eligibility.EYE_MAX_ABS_PITCH_DEG, beforePitch);
});

test('U2. the baselines remain the documented comparison points', () => {
  assert.equal(CONFIG.state.DOWN_PITCH_SUPPORT_DEG, 25,
    'pitch-down support baseline');
  assert.equal(CONFIG.eye.eligibility.EYE_MAX_ABS_PITCH_DEG, 15,
    'eye eligibility baseline');
  // Neither was changed by this task. Any change must be a separate,
  // deliberate decision made on the evidence.
});

// ═══════════════════════════════════════════════════════════════════════
// §7 — pitch-down SUPPORT threshold
// ═══════════════════════════════════════════════════════════════════════
test('U3. the baseline 25° cannot capture natural study posture', () => {
  // The pilot measured natural D06 downward posture at 14.7°–16.9°. The
  // baseline sits above that entire range, so the support cue it exists to
  // record never fires during real studying.
  const cfg = withCfg({ state: { DOWN_PITCH_SUPPORT_DEG: 25 } });
  for (const depth of [14.7, 15.8, 16.9]) {
    assert.equal(replay(cfg, studyDown(depth)).pitchDownMs, 0,
      `25° misses natural posture at ${depth}°`);
  }
});

test('U4. 18° and 20° also sit above the observed natural range', () => {
  // Not an artefact of the trace: the pilot range simply never reaches them.
  for (const cand of [18, 20]) {
    const cfg = withCfg({ state: { DOWN_PITCH_SUPPORT_DEG: cand } });
    for (const depth of [14.7, 15.8, 16.9]) {
      assert.equal(replay(cfg, studyDown(depth)).pitchDownMs, 0,
        `${cand}° misses natural posture at ${depth}°`);
    }
  }
});

test('U5. 15° captures most natural study posture', () => {
  const cfg = withCfg({ state: { DOWN_PITCH_SUPPORT_DEG: 15 } });
  const hits = [14.7, 15.8, 16.9]
    .filter((d) => replay(cfg, studyDown(d)).pitchDownMs > 0).length;
  assert.equal(hits, 2, '15° captures the upper two of three sampled depths');
  // The shallowest natural posture still escapes it — an honest limit of the
  // candidate, not a reason to drop lower without evidence.
  assert.equal(replay(cfg, studyDown(14.7)).pitchDownMs, 0);
});

test('U6. no pitch-down candidate activates on neutral posture', () => {
  // The constraint that matters: a support cue that fires while sitting
  // normally is noise, not context.
  for (const cand of [15, 18, 20, 25]) {
    const cfg = withCfg({ state: { DOWN_PITCH_SUPPORT_DEG: cand } });
    assert.equal(replay(cfg, neutral()).pitchDownMs, 0,
      `${cand}° false-activates on neutral`);
  }
});

test('U7. no pitch-down candidate produces ANY strong evidence', () => {
  // The invariant the whole tuning rests on: lowering a SUPPORT threshold
  // cannot create distraction, at any candidate value.
  for (const cand of [15, 18, 20, 25]) {
    const cfg = withCfg({ state: { DOWN_PITCH_SUPPORT_DEG: cand } });
    for (const trace of [neutral(), studyDown(16.9), reading(16)]) {
      const r = replay(cfg, trace);
      assert.equal(r.yawMs + r.pitchUpMs + r.eyeMs, 0,
        `${cand}° produced strong evidence`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════
// §12 — eye eligibility (EYE_MAX_ABS_PITCH_DEG)
// ═══════════════════════════════════════════════════════════════════════
test('U8. the baseline 15° admits reading/writing false closure', () => {
  // This is the reported problem, reproduced against the real engine: eyes
  // OPEN, but a downward reading pose with depressed EAR stays eligible long
  // enough to complete the 3 s closure persistence.
  const cfg = withCfg({ eyeEligibility: { EYE_MAX_ABS_PITCH_DEG: 15 } });
  const r = replay(cfg, reading(13.5));
  assert.ok(r.eyeMs > 0, 'baseline eligibility lets reading fire closure');
  assert.ok(r.eyeMs > 3000, `sustained false closure: ${r.eyeMs}ms`);
});

test('U9. 12° and 10° suppress reading false closure', () => {
  for (const cand of [12, 10]) {
    const cfg = withCfg({ eyeEligibility: { EYE_MAX_ABS_PITCH_DEG: cand } });
    assert.equal(replay(cfg, reading(13.5)).eyeMs, 0,
      `${cand}° should suppress reading false closure`);
  }
});

test('U10. every candidate preserves a level true closure', () => {
  // D09 performed as instructed — frontal, level — survives all three.
  for (const cand of [15, 12, 10]) {
    const cfg = withCfg({ eyeEligibility: { EYE_MAX_ABS_PITCH_DEG: cand } });
    const r = replay(cfg, eyesClosed(0));
    assert.ok(r.eyeMs > 0, `${cand}° lost a level true closure`);
    assert.ok(r.firstEyeMs > CONFIG.state.EYE_CLOSED_PERSIST_MS,
      'and only after the configured persistence');
  }
});

test('U11. lowering eligibility narrows the head-pitch headroom for D09', () => {
  // The trade-off that stops this being a free win: the SAME parameter governs
  // both failure modes, so suppressing reading also shrinks how far an
  // operator may tilt down while genuinely closing their eyes.
  const retained = (cand) => [0, 3, 5, 8, 10, 11, 12, 13]
    .filter((p) => replay(
      withCfg({ eyeEligibility: { EYE_MAX_ABS_PITCH_DEG: cand } }),
      eyesClosed(p)).eyeMs > 0).length;

  const at15 = retained(15);
  const at12 = retained(12);
  const at10 = retained(10);
  assert.ok(at15 > at12, 'lowering to 12° costs true-closure headroom');
  assert.ok(at12 > at10, 'lowering to 10° costs more');
});

test('U12. no candidate separates the two failure modes cleanly', () => {
  // The finding the recommendation rests on. At 12°, shallow reading (≤10°)
  // still false-fires while a D09 closure tilted past 11° is already lost:
  // the safe band for one mode overlaps the unsafe band for the other.
  const cfg = withCfg({ eyeEligibility: { EYE_MAX_ABS_PITCH_DEG: 12 } });
  assert.ok(replay(cfg, reading(10)).eyeMs > 0,
    'shallow reading still false-fires at 12°');
  assert.equal(replay(cfg, eyesClosed(11)).eyeMs, 0,
    'while a slightly-tilted true closure is already lost at 12°');
});

test('U13. normal blinking stays safe at every candidate', () => {
  // The component the pilot found stable must not be collateral damage.
  for (const cand of [15, 12, 10]) {
    const cfg = withCfg({ eyeEligibility: { EYE_MAX_ABS_PITCH_DEG: cand } });
    assert.equal(replay(cfg, blinks()).eyeMs, 0,
      `${cand}° let a blink complete closure persistence`);
  }
});

test('U14. neutral posture never fires closure at any candidate', () => {
  for (const cand of [15, 12, 10]) {
    const cfg = withCfg({ eyeEligibility: { EYE_MAX_ABS_PITCH_DEG: cand } });
    assert.equal(replay(cfg, neutral()).eyeMs, 0);
  }
});

test('U15. the EAR threshold and persistence are untouched by this study', () => {
  // Investigation order: pose eligibility first, EAR only if eligibility
  // cannot solve it, persistence last. Blink-vs-closure temporal behaviour
  // already works, so it is not destabilised speculatively.
  assert.equal(CONFIG.state.EAR_RELATIVE_THRESHOLD, 0.7);
  assert.equal(CONFIG.state.EYE_CLOSED_PERSIST_MS, 3000);
});
