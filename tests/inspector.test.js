/**
 * Live Model Inspector + benchmark methodology guards.
 *
 * The inspector renders continuously so failure modes are visible in real time.
 * That makes one boundary critical: what the inspector shows must never become
 * benchmark evidence. Only samples offered inside a bounded recording window
 * may reach a trial. These tests hold that line, and hold the locked
 * full-evaluation methodology.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { TrialController, TrialState } from '../tools/shared/TrialController.js';
import {
  CANDIDATES, PERSON_SCENARIOS, PHONE_SCENARIOS,
  BENCH_COUNTDOWN_MS, BENCH_RECORDING_MS,
} from '../tools/benchmark/candidates.js';
import {
  buildModelSummaries, buildRecommendation, requiredScenarios,
  MODEL_SUMMARY_COLUMNS,
} from '../tools/benchmark/exportResults.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), 'utf8');
const page = () => read('../public/benchmark.html');

// ── The recording boundary ──────────────────────────────────────────────
test('I1. live observations outside recording are never committed', () => {
  const scenario = {
    id: 'frontal_seated', label: 'x', countdownMs: BENCH_COUNTDOWN_MS,
    recordingDurationMs: BENCH_RECORDING_MS,
  };
  const tc = new TrialController({ requiredRepetitions: 3 });
  tc.cameraStarted();
  tc.selectScenario(scenario);

  // Camera live, no trial: the inspector is updating, nothing may be stored.
  assert.equal(tc.offerSample({ timestampMs: 10, phoneMaxScore: 0.9 }), false,
    'a sample before START TRIAL must be rejected');

  tc.startTrial(1000);
  // Countdown is for getting into position — still not recording.
  assert.equal(tc.offerSample({ timestampMs: 1100, phoneMaxScore: 0.9 }), false,
    'countdown samples must be rejected');

  tc.tick(1000 + BENCH_COUNTDOWN_MS + 1);
  assert.equal(tc.state, TrialState.RECORDING);
  const inside = 1000 + BENCH_COUNTDOWN_MS + 50;
  assert.equal(tc.offerSample({ timestampMs: inside, phoneMaxScore: 0.7 }), true,
    'samples inside the window are accepted');
  assert.equal(tc.samples.length, 1);
});

test('I2. samples after auto-stop do not leak into the trial', () => {
  const scenario = {
    id: 'frontal_seated', label: 'x', countdownMs: 0,
    recordingDurationMs: 1000,
  };
  let done = null;
  const tc = new TrialController({
    requiredRepetitions: 3, onTrialComplete: (t) => { done = t; },
  });
  tc.cameraStarted();
  tc.selectScenario(scenario);
  tc.startTrial(0);
  tc.tick(1);
  tc.offerSample({ timestampMs: 10, phoneMaxScore: 0.5 });
  tc.tick(1200);                       // past the window: auto-stop
  assert.ok(done, 'the trial completed');
  const after = tc.offerSample({ timestampMs: 1300, phoneMaxScore: 0.99 });
  assert.equal(after, false, 'post-window frames must be rejected');
  assert.equal(done.samples.length, 1, 'only the in-window sample was kept');
});

// ── Locked methodology ──────────────────────────────────────────────────
test('I3. every candidate uses the complete official scenario matrix', () => {
  assert.equal(PERSON_SCENARIOS.length, 9);
  assert.equal(PHONE_SCENARIOS.length, 10);
  // The set a candidate must cover is never a subset.
  assert.equal(requiredScenarios('person').length, 9);
  assert.equal(requiredScenarios('phone').length, 10);
  assert.equal(requiredScenarios('pose').length, 9, 'presence shares the person set');

  const ids = CANDIDATES.map((c) => c.id);
  for (const want of ['edl0-f16', 'edl2-f16', 'ssd-mnv2-f32', 'pose-lite']) {
    assert.ok(ids.includes(want), `missing candidate ${want}`);
  }
  const pose = CANDIDATES.find((c) => c.id === 'pose-lite');
  assert.equal(pose.task, 'pose', 'Pose Lite is the presence challenger only');
});

test('I4. no staged elimination anywhere in the official flow', () => {
  const html = page();
  for (const banned of ['Quick Screening', 'QUICK_PERSON', 'QUICK_PHONE',
                        'Stage 1', 'Stage 2', 'ADVANCE', 'BORDERLINE']) {
    assert.ok(!html.includes(banned), `benchmark page still mentions ${banned}`);
  }
  // "DROP" must not appear as a verdict; guard the word in a verdict context.
  assert.ok(!/verdict[^<]*DROP|>DROP</.test(html), 'no DROP verdict');
  for (const col of MODEL_SUMMARY_COLUMNS) {
    assert.ok(!/advance|borderline|drop/i.test(col),
      `summary column "${col}" encodes staged elimination`);
  }
});

// ── Ranking honesty ─────────────────────────────────────────────────────
const mkTrial = (modelId, task, scenarioId, rep, detected, expected) => ({
  trialId: `${modelId}_${task}_${scenarioId}_${rep}`,
  modelId, task, scenarioId, repetition: rep,
  expectedTargetPresent: expected,
  detected,
  maxScore: detected ? 0.8 : 0.05,
  competingClass: null, competingScore: 0, rawDetectionCount: detected ? 1 : 0,
  falsePositive: !expected && detected,
  falseNegative: expected && !detected,
  inferenceMs: 20, p95InferenceMs: 25, delegate: 'GPU',
  durationMs: BENCH_RECORDING_MS, videoWidth: 640, videoHeight: 480,
  recordedAtIso: '2026-09-04T00:00:00.000Z',
});

/** A fully evaluated candidate/task: every scenario, 3 repetitions. */
const completeSet = (modelId, task) => {
  const out = [];
  for (const s of requiredScenarios(task)) {
    for (let r = 1; r <= 3; r++) {
      out.push(mkTrial(modelId, task, s.id, r, s.expect, s.expect));
    }
  }
  return out;
};

test('I5. an incomplete candidate is never given a final rank', () => {
  const trials = [
    ...completeSet('edl2-f16', 'phone'),
    // Only one scenario, one repetition: nowhere near complete.
    mkTrial('edl0-f16', 'phone', 'screen_portrait', 1, true, true),
  ];
  const rows = buildModelSummaries(trials, { requiredRepetitions: 3 });
  const partial = rows.find((r) => r.model === 'edl0-f16');
  const full = rows.find((r) => r.model === 'edl2-f16');
  assert.equal(partial.completenessFlag, 'INCOMPLETE');
  assert.equal(partial.finalRank, null, 'incomplete candidates carry no rank');
  assert.equal(full.completenessFlag, 'COMPLETE');
  assert.ok(full.finalRank >= 1, 'a complete candidate is ranked');
});

test('I6. no recommendation is produced from partial evidence', () => {
  // Phone complete, presence untouched: not enough to recommend an architecture.
  const rec = buildRecommendation(completeSet('edl2-f16', 'phone'),
    { requiredRepetitions: 3 });
  assert.equal(rec.strategy, 'INCOMPLETE');
  assert.equal(rec.presenceModel, null);
  assert.equal(rec.phoneModel, null);
  assert.match(rec.rationale, /complete all scenarios/i);
});

test('I7. the page shows ranking only once a task is fully evaluated', () => {
  const html = page();
  const js = html.slice(html.indexOf('<script type="module">'));
  assert.match(js, /Final ranking becomes available after all/,
    'the ranking block must state when evidence is incomplete');
  assert.match(js, /completenessFlag === 'COMPLETE'/,
    'ranking must gate on completeness');
  assert.match(js, /PRELIM/, 'partial metrics must be marked preliminary');
});

// ── Inspector is diagnostic only ────────────────────────────────────────
test('I8. the inspector reads observations but never records them', () => {
  const html = page();
  const js = html.slice(html.indexOf('<script type="module">'));
  // The only path into a trial is offerSample, which the controller bounds.
  const commits = js.match(/runner\.recordTrial\(/g) ?? [];
  assert.equal(commits.length, 1,
    'exactly one commit path, inside onTrialComplete');
  const ctx = js.slice(js.indexOf('function onTrialComplete'),
                       js.indexOf('function toast'));
  assert.match(ctx, /BenchmarkRunner\.peak\(trial\.samples\)/,
    'the peak must come from the bounded trial samples, not the live window');
  // renderInspector/drawOverlay must not touch the runner's trial store.
  const insp = js.slice(js.indexOf('function renderInspector'),
                        js.indexOf('function loop()'));
  assert.ok(!/recordTrial|getValidTrials|\.trials\b/.test(insp),
    'the inspector must not read or write benchmark trial data');
});

test('I9. the camera overlay is visualisation only — no frame is retained', () => {
  const html = page();
  const js = html.slice(html.indexOf('<script type="module">'));
  const draw = js.slice(js.indexOf('function drawOverlay'),
                        js.indexOf('function drawSpark'));
  // Reading pixels out of the canvas or the video is how imagery leaks.
  for (const banned of ['toDataURL', 'getImageData', 'drawImage', 'captureStream',
                        'toBlob', 'createImageBitmap']) {
    assert.ok(!draw.includes(banned), `overlay must not call ${banned}`);
  }
  // It draws geometry the model already reported, nothing more.
  assert.match(draw, /strokeRect/);
  assert.match(draw, /boundingBox/);
});

test('I10. the live trend is bounded and never persisted', () => {
  const html = page();
  const js = html.slice(html.indexOf('<script type="module">'));
  assert.match(js, /TREND_MS/, 'the trend window is explicit');
  assert.match(js, /while \(trend\.length && now - trend\[0\]\.t > TREND_MS\) trend\.shift\(\)/,
    'old trend points must be dropped, not accumulated');
  // The trend must not appear in anything that gets exported.
  const exp = read('../tools/benchmark/exportResults.js');
  assert.ok(!/\btrend\b/.test(exp), 'the live trend must never reach an export');
});

// ── §40: model families get their own inspector ─────────────────────────
test('I11. Pose Lite does not invent object classes', () => {
  const html = page();
  const js = html.slice(html.indexOf('<script type="module">'));
  // A pose model has no notion of "cell phone". Rendering an object-class
  // table for it would fabricate a score for a class it cannot report.
  assert.match(js, /function renderInspector/);
  assert.match(js, /const pose = isPose\(\)/,
    'the inspector must branch on model family');
  assert.match(js, /\$\('poseBlock'\)\.style\.display = pose \? '' : 'none'/);
  assert.match(js, /\$\('objBlock'\)\.style\.display = pose \? 'none' : ''/);
  assert.match(js, /\$\('detailBlock'\)\.style\.display = pose \? 'none' : ''/,
    'the object-class table must hide for pose models');
  // The pose readout uses only fields the runner actually produces.
  const poseArm = js.slice(js.indexOf('if (pose) {'), js.indexOf('const phonePrimary'));
  for (const real of ['bodyDetected', 'landmarkCount', 'visibleLandmarks', 'presenceScore']) {
    assert.ok(poseArm.includes(real), `pose readout must use ${real}`);
  }
  // And invents nothing.
  for (const fake of ['poseConfidence', 'phoneMaxScore', 'personMaxScore']) {
    assert.ok(!poseArm.includes(fake), `pose readout must not use ${fake}`);
  }
});

test('I12. metrics are computed in ONE layer, never re-derived in the UI', () => {
  const html = page();
  const js = html.slice(html.indexOf('<script type="module">'));
  // The page must not compute recall/specificity itself; a second
  // implementation is how a UI number and an exported number diverge.
  // Assignment, not comparison: 'r.specificity === 1' is READING the value.
  for (const banned of ['taskMetrics(', 'tp / (tp', 'tp + fn', 'tn + fp']) {
    assert.ok(!js.includes(banned),
      `the page must not recompute metrics (${banned})`);
  }
  assert.match(js, /buildModelSummaries/,
    'comparison reads the single authoritative summary layer');
});
