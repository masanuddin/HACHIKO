/**
 * Pre-benchmark stabilization gates.
 *
 * GATE A — benchmark data capture must preserve enough bounded raw evidence
 * that an operating threshold can be DERIVED later, without re-running trials
 * merely because the score distribution was discarded.
 *
 * GATE B — yaw evidence must treat left and right under the same semantic
 * rule, so no direction fails systematically because of implementation.
 *
 * Neither gate selects a model, a threshold, or a persistence parameter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BenchmarkRunner } from '../tools/benchmark/BenchmarkRunner.js';
import {
  buildExportBundle, buildScenarioSummaries, buildModelSummaries,
} from '../tools/benchmark/exportResults.js';
import { CONFIG } from '../src/ai/index.js';
import { EvidenceEngine } from '../src/ai/pipeline/EvidenceEngine.js';
import { FeatureSmoother } from '../src/ai/pipeline/FeatureSmoother.js';
import { TemporalTracker } from '../src/ai/pipeline/TemporalTracker.js';
import { CalibrationEngine } from '../src/ai/pipeline/CalibrationEngine.js';

// ══ GATE A ══════════════════════════════════════════════════════════════
const window90 = () => Array.from({ length: 90 }, (_, i) => ({
  timestampMs: 1000 + i * 33,
  personDetected: true,
  personMaxScore: 0.2 + 0.5 * Math.sin((i / 90) * Math.PI),
  phoneDetected: false, phoneMaxScore: 0.03,
  topOther: [{ categoryName: 'chair', score: 0.12 }],
  rawCount: 3, inferenceMs: 15 + (i % 5),
}));

function seeded(phase = 'DEVELOPMENT') {
  const r = new BenchmarkRunner({}, {});
  const samples = window90();
  const obs = BenchmarkRunner.peak(samples);
  Object.assign(obs, { modelId: 'edl0-f16', delegate: 'GPU',
    videoWidth: 640, videoHeight: 480 });
  const t = r.recordTrial({ task: 'person', scenarioId: 'frontal_seated',
    expected: true, observation: obs, samples, phase });
  return { r, t, samples };
}

test('A1. a trial records its experiment phase', () => {
  assert.equal(seeded('DEVELOPMENT').t.phase, 'DEVELOPMENT');
  assert.equal(seeded('VALIDATION').t.phase, 'VALIDATION');
  // Absent phase stays null: guessing which phase a historical trial belonged
  // to is exactly the contamination the field exists to prevent.
  const r = new BenchmarkRunner({}, {});
  const s = window90();
  const o = BenchmarkRunner.peak(s);
  o.modelId = 'edl0-f16';
  assert.equal(r.recordTrial({ task: 'person', scenarioId: 'frontal_seated',
    expected: true, observation: o, samples: s }).phase, null);
});

test('A2. the bounded per-frame series survives into the trial', () => {
  const { t, samples } = seeded();
  assert.equal(t.sampleCount, 90);
  assert.equal(t.samples.length, 90);
  const mid = t.samples[45];
  // Everything a later threshold analysis needs, per frame.
  assert.equal(mid.elapsedMs, 45 * 33, 'relative time');
  assert.equal(typeof mid.personMaxScore, 'number', 'target score');
  assert.equal(typeof mid.phoneMaxScore, 'number',
    'the NON-target score too — it is unrecoverable afterwards');
  assert.equal(mid.competingClass, 'chair');
  assert.equal(mid.competingScore, 0.12);
  assert.equal(typeof mid.inferenceMs, 'number', 'per-frame latency');
  // Geometry is a visualisation aid, not evidence.
  assert.ok(!('boundingBox' in mid) && !('detections' in mid));
  assert.equal(t.samples[0].timestampMs, samples[0].timestampMs);
});

test('A2b. the score DISTRIBUTION is recoverable, not just a peak', () => {
  // This is the whole point of Gate A. A trial holding only `detected: true`
  // and one peak cannot support choosing an operating threshold later.
  const { t } = seeded();
  const scores = t.samples.map((x) => x.personMaxScore).filter(Number.isFinite);
  assert.equal(scores.length, 90);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  assert.ok(max - min > 0.3, `distribution must be visible, got ${min}..${max}`);
});

test('A3. per-trial summary fields derive from the same window', () => {
  const { t, samples } = seeded();
  const peaks = samples.map((s) => s.personMaxScore);
  assert.equal(t.maxScore, Math.max(...peaks), 'peak target score');
  assert.equal(t.detected, true, 'detection occurrence');
  assert.equal(t.competingClass, 'chair', 'strongest competitor');
  const lat = samples.map((s) => s.inferenceMs).sort((a, b) => a - b);
  assert.equal(t.inferenceMs, lat[lat.length >> 1], 'latency p50');
});

test('A4. pose trials keep real API signals and invent no class score', () => {
  const r = new BenchmarkRunner({}, {});
  // Shaped exactly as _observePose emits: landmark facts, no object classes.
  const samples = Array.from({ length: 30 }, (_, i) => ({
    timestampMs: 1000 + i * 33, bodyDetected: true, landmarkCount: 33,
    visibleLandmarks: 28, presenceScore: 28 / 33,
    personDetected: true, personMaxScore: 28 / 33,
    phoneDetected: false, phoneMaxScore: null, topOther: [], inferenceMs: 19,
  }));
  const obs = BenchmarkRunner.peak(samples);
  obs.modelId = 'pose-lite';
  const t = r.recordTrial({ task: 'pose', scenarioId: 'frontal_seated',
    expected: true, observation: obs, samples, phase: 'DEVELOPMENT' });
  const mid = t.samples[10];
  assert.equal(mid.bodyDetected, true);
  assert.equal(mid.landmarkCount, 33);
  assert.equal(mid.visibleLandmarks, 28);
  assert.equal(typeof mid.presenceScore, 'number');
  // No fabricated phone confidence for a model with no such concept.
  assert.equal(mid.phoneMaxScore, null);
  assert.equal(mid.competingClass, null);
});

test('A5. abort stores nothing; delete removes the newest trial entirely', () => {
  const { r, t } = seeded();
  const second = r.recordTrial({ task: 'person', scenarioId: 'frontal_seated',
    expected: true, observation: { ...BenchmarkRunner.peak(window90()),
      modelId: 'edl0-f16' }, samples: window90(), phase: 'DEVELOPMENT' });
  assert.equal(r.getValidTrials().length, 2);

  const removed = r.deleteLastTrial();
  assert.equal(removed.trialId, second.trialId, 'the MOST RECENT trial');
  assert.equal(r.getValidTrials().length, 1, 'progress decrements');

  const bundle = buildExportBundle({ trials: r.getTrials(),
    session: { sessionId: 's1', requiredRepetitions: 3 } });
  const all = bundle.files.map((f) => f.content).join('\n');
  assert.ok(!all.includes(second.trialId), 'absent from every export file');
  // A tombstone is a row still present but flagged dead.
  assert.ok(!/"valid"\s*:\s*false/.test(all));
  assert.ok(!/discardedTrials/.test(all));

  assert.equal(buildScenarioSummaries(r.getTrials(), { requiredRepetitions: 3 })[0]
    .repetitionsCompleted, 1, 'scenario summary recalculates');
  assert.equal(buildModelSummaries(r.getTrials(), { requiredRepetitions: 3 })[0]
    .completenessFlag, 'INCOMPLETE', 'model summary recalculates');
  assert.ok(t.trialId, 'the surviving trial is untouched');
});

test('A6. the page never recomputes scientific metrics from display values', () => {
  const html = readPage();
  const js = html.slice(html.indexOf('<script type="module">'));
  for (const banned of ['taskMetrics(', 'tp + fn', 'tn + fp']) {
    assert.ok(!js.includes(banned), `the page must not recompute (${banned})`);
  }
  assert.match(js, /buildModelSummaries/);
  assert.match(js, /buildScenarioSummaries/);
});

test('A7. exports carry phase and the retained samples', () => {
  const { r } = seeded();
  const bundle = buildExportBundle({ trials: r.getTrials(),
    session: { sessionId: 's1', requiredRepetitions: 3 } });
  const json = bundle.files.find((f) => f.name.endsWith('.json')).content;
  assert.match(json, /"samples"/, 'the bounded series reaches the JSON');
  assert.match(json, /"phase"/);
  assert.match(json, /"sampleCount"/);
  assert.ok(!/data:image|blob:|ImageData|base64/.test(json), 'no imagery');

  // The workbook surfaces both for a human reader.
  const book = new TextDecoder().decode(
    bundle.files.find((f) => f.name.endsWith('.xlsx')).content);
  assert.ok(book.includes('DEVELOPMENT'));
  assert.ok(book.includes('Raw Samples'));
});

const readPage = () =>
  readFileSync(new URL('../public/benchmark.html', import.meta.url), 'utf8');

// ══ GATE B ══════════════════════════════════════════════════════════════
const FRAME = 1000 / 30;
const S = CONFIG.state;

/**
 * Drive the REAL chain: raw yaw → calibration → smoothing → evidence →
 * persistence, and report when yaw evidence first activates.
 */
function runYaw(rawYawOf, { baselineYaw = 0, durationMs = 4000,
                            signalValidOf = () => true } = {}) {
  const ev = new EvidenceEngine(CONFIG);
  const sm = new FeatureSmoother(CONFIG);
  const tt = new TemporalTracker(CONFIG, ev);
  const cal = new CalibrationEngine(CONFIG);
  const m = (yaw) => ({ facePresent: true, poseValid: true, yawRaw: yaw,
    pitchRaw: 0, rollRaw: 0, earLeft: 0.3, earRight: 0.3, earMean: 0.3 });

  let t = 0;
  cal.start(t);
  for (; t < CONFIG.calibration.CALIBRATION_DURATION_MS + 300; t += FRAME) {
    cal.update(m(baselineYaw), t);
  }
  let firstActive = null;
  let maxSmoothed = 0;
  const end = t + durationMs;
  for (let n = 0; t < end; t += FRAME, n++) {
    const valid = signalValidOf(n);
    const c = cal.applyTo(m(rawYawOf(t)));
    const s = sm.update({ yawDelta: c.yawDelta, pitchDelta: c.pitchDelta,
      rollDelta: c.rollDelta, earRelative: c.earRelative }, t, valid);
    maxSmoothed = Math.max(maxSmoothed, Math.abs(s.yawSmoothed ?? 0));
    const out = tt.update({ facePresent: true, signalValid: valid,
      yawSmoothed: s.yawSmoothed, pitchSmoothed: s.pitchSmoothed,
      rollSmoothed: s.rollSmoothed, earSmoothed: s.earSmoothed,
      yawDelta: c.yawDelta, pitchDelta: c.pitchDelta }, t);
    if (out.persisted?.yawStrong && firstActive === null) firstActive = t;
  }
  return { firstActive, maxSmoothed };
}

const hold = (deg) => () => deg;
const TOL = FRAME * 2;

test('B1. sustained yaw past threshold activates in BOTH directions', () => {
  for (const deg of [40, 30, 26]) {
    const right = runYaw(hold(deg));
    const left = runYaw(hold(-deg));
    assert.ok(right.firstActive !== null, `+${deg}° must activate`);
    assert.ok(left.firstActive !== null, `-${deg}° must activate`);
    assert.ok(Math.abs(right.firstActive - left.firstActive) <= TOL,
      `${deg}°: activation times must match (R ${right.firstActive}, L ${left.firstActive})`);
  }
});

test('B2. sub-threshold yaw activates in NEITHER direction', () => {
  for (const deg of [24, 15, 5]) {
    assert.equal(runYaw(hold(deg)).firstActive, null, `+${deg}° must not activate`);
    assert.equal(runYaw(hold(-deg)).firstActive, null, `-${deg}° must not activate`);
  }
});

test('B3. a calibration offset does not favour one direction', () => {
  // The rule is "deviation from YOUR baseline", so an off-centre neutral must
  // not make one side easier to trigger than the other.
  for (const base of [12, -12, 20]) {
    for (const deg of [40, 30]) {
      const away = runYaw(hold(base + deg), { baselineYaw: base });
      const back = runYaw(hold(base - deg), { baselineYaw: base });
      assert.ok(away.firstActive !== null && back.firstActive !== null,
        `baseline ${base}°, ±${deg}° must both activate`);
      assert.ok(Math.abs(away.firstActive - back.firstActive) <= TOL,
        `baseline ${base}°, ±${deg}°: must match`);
    }
  }
});

test('B4. a brief excursion never satisfies persistence, either way', () => {
  const pulse = (sign) => (t) => (t % 2000 < 400 ? sign * 40 : 0);
  assert.equal(runYaw(pulse(1)).firstActive, null);
  assert.equal(runYaw(pulse(-1)).firstActive, null);
});

test('B5. returning to neutral resets the timer symmetrically', () => {
  // Hold well SHORT of the persistence window, then return to neutral long
  // enough to exceed the tolerance. Neither direction may latch.
  const shortHold = (sign) => (t) => {
    const phase = t % 2400;
    return phase < 900 ? sign * 40 : 0;   // 900ms hold, 1500ms neutral
  };
  assert.equal(runYaw(shortHold(1), { durationMs: 7000 }).firstActive, null,
    'right: repeated short holds must not accumulate across gaps');
  assert.equal(runYaw(shortHold(-1), { durationMs: 7000 }).firstActive, null,
    'left: same');

  // And a hold that DOES complete the window latches in both directions, at
  // the same time — the reset is not one-sided.
  const right = runYaw(hold(40), { durationMs: 4000 });
  const left = runYaw(hold(-40), { durationMs: 4000 });
  assert.ok(right.firstActive !== null && left.firstActive !== null);
  assert.ok(Math.abs(right.firstActive - left.firstActive) <= TOL);
});

test('B6. REGRESSION: pose-validity dropout, not direction, blocks evidence', () => {
  // The live report was "one direction fails at comparable angle". The yaw
  // maths is symmetric (B1-B5), so the real mechanism is upstream signal loss:
  // once a gap exceeds the timer's tolerance the accumulator resets, and at a
  // high enough dropout rate the evidence can NEVER latch — at an angle that
  // works fine on the stable side. This test pins that mechanism so the cause
  // is not mistaken for a directional bug again.
  const tolerance = Math.min(400, S.YAW_PERSIST_MS / 3);
  const stable = runYaw(hold(40), { durationMs: 6000 });
  assert.ok(stable.firstActive !== null, 'stable signal activates');

  // Gaps shorter than the tolerance are forgiven.
  const shortGap = runYaw(hold(40), { durationMs: 6000,
    signalValidOf: (n) => (n % 10) >= 3 });        // ~100ms gaps
  assert.ok(shortGap.firstActive !== null,
    'short dropouts must be forgiven by design');

  // Gaps longer than the tolerance reset the accumulator every cycle.
  const longGap = runYaw(hold(40), { durationMs: 6000,
    signalValidOf: (n) => (n % 30) >= 16 });       // ~533ms gaps > tolerance
  assert.equal(longGap.firstActive, null,
    `gaps beyond the ${tolerance}ms tolerance must prevent latching`);

  // And it is direction-independent: the same dropout blocks the other side.
  const longGapLeft = runYaw(hold(-40), { durationMs: 6000,
    signalValidOf: (n) => (n % 30) >= 16 });
  assert.equal(longGapLeft.firstActive, null,
    'the failure is caused by signal loss, not by turn direction');
});

test('B7. yaw evidence is non-directional by construction', () => {
  // Guard the intended semantics at the source, not just by behaviour.
  const src = readFileSync(
    new URL('../src/ai/pipeline/EvidenceEngine.js', import.meta.url), 'utf8');
  assert.match(src, /Math\.abs\(yawSmoothed\)\s*>\s*s\.STRONG_YAW_DELTA_DEG/,
    'yaw must compare absolute deviation');
  // Pitch, by contrast, is intentionally directional — do not "fix" it.
  assert.match(src, /pitchSmoothed\s*>\s*s\.STRONG_UP_PITCH_DELTA_DEG/);
});
