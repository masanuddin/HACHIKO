/**
 * v0.3 bake-off tests — candidate declarations, scoring, and decision rules.
 *
 * The bake-off decides which perception model HACHIKO ships, so the ranking
 * must be reproducible rather than a judgement written up afterwards. These
 * tests pin the maths and the decision rules; the live matrix supplies the data.
 *
 * EXPERIMENTAL — none of this is imported by production code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANDIDATES, PERSON_SCENARIOS, PHONE_SCENARIOS,
  DECISION_WEIGHTS, BENCH_SCORE_THRESHOLD,
} from '../tools/benchmark/candidates.js';
import {
  recall, falsePositiveCount, meanTrueScore, latencyScore, sizeScore,
  scoreCandidate, rank, decideStrategy, median, toMarkdownTable,
  separation, discriminability, sensitivity, specificity, precision,
  falseNegativeCount, taskMetrics, quickVerdict, quickVerdictByCandidate,
  QUICK_CRITERIA,
} from '../tools/benchmark/score.js';
import { BenchmarkRunner } from '../tools/benchmark/BenchmarkRunner.js';
import { CONFIG } from '../src/ai/index.js';

const trial = (over = {}) => ({
  modelId: 'm', task: 'person', scenarioId: 's', expected: true,
  detected: true, maxScore: 0.9, falsePositive: false, inferenceMs: 20, ...over,
});

// ── Candidate declarations ──────────────────────────────────────────────
test('B1. candidates use official MediaPipe assets only', () => {
  for (const c of CANDIDATES) {
    assert.ok(c.url.startsWith('https://storage.googleapis.com/mediapipe-models/'),
      `${c.id} must come from the official model host`);
  }
});

test('B2. INT8 is not among the compared candidates', () => {
  for (const c of CANDIDATES) {
    assert.ok(!/int8/i.test(c.url), `${c.id} must not be an INT8 build`);
  }
});

test('B3. each object candidate declares its OWN label indices', () => {
  // SSD MobileNetV2 carries a `background` class at index 0, so person/phone
  // are 1/77 while EfficientDet uses 0/76. A single shared index pair would
  // silently mis-label an entire model's output.
  const byId = Object.fromEntries(CANDIDATES.map((c) => [c.id, c]));
  assert.deepEqual(byId['edl0-f16'].labelIndices, { PERSON: 0, PHONE: 76 });
  assert.deepEqual(byId['edl2-f16'].labelIndices, { PERSON: 0, PHONE: 76 });
  assert.deepEqual(byId['ssd-mnv2-f32'].labelIndices, { PERSON: 1, PHONE: 77 });
  // Verified against each model's embedded labels.txt by scripts/fetch-bench-models.mjs.
  assert.notDeepEqual(
    byId['edl0-f16'].labelIndices, byId['ssd-mnv2-f32'].labelIndices,
    'the index trap must remain explicit');
});

test('B4. the pose candidate is declared presence-only', () => {
  const pose = CANDIDATES.find((c) => c.id === 'pose-lite');
  assert.equal(pose.task, 'pose');
  assert.ok(/presence/i.test(pose.notes));
  assert.ok(/never.*focus|not.*posture|NEVER/i.test(pose.notes),
    'its scope limits must be stated in the declaration');
});

test('B5. one shared diagnostic threshold for every candidate', () => {
  assert.ok(BENCH_SCORE_THRESHOLD >= 0.05 && BENCH_SCORE_THRESHOLD <= 0.10);
  // Production config must be untouched by the bake-off.
  assert.equal(CONFIG.objectDetector.scoreThreshold, 0.30);
  assert.equal(CONFIG.objectDetector.minPersonConfidence, 0.40);
  assert.equal(CONFIG.objectDetector.minPhoneConfidence, 0.50);
});

test('B6. scenario lists cover the required cases with negative controls', () => {
  const personIds = PERSON_SCENARIOS.map((s) => s.id);
  for (const required of ['frontal_seated', 'extreme_yaw', 'back_facing',
                          'face_covered', 'reading_writing', 'empty_frame']) {
    assert.ok(personIds.includes(required), `missing person scenario ${required}`);
  }
  const phoneIds = PHONE_SCENARIOS.map((s) => s.id);
  for (const required of ['screen_portrait', 'back_landscape', 'study_distance',
                          'on_desk', 'partly_occluded', 'no_phone']) {
    assert.ok(phoneIds.includes(required), `missing phone scenario ${required}`);
  }
  // Every task needs a negative control, or false positives are unmeasurable.
  assert.ok(PERSON_SCENARIOS.some((s) => !s.expect));
  assert.ok(PHONE_SCENARIOS.some((s) => !s.expect));
});

test('B7. decision weights match the specification and sum to 1', () => {
  assert.equal(DECISION_WEIGHTS.accuracy, 0.40);
  assert.equal(DECISION_WEIGHTS.falsePositives, 0.20);
  assert.equal(DECISION_WEIGHTS.latency, 0.15);
  assert.equal(DECISION_WEIGHTS.size, 0.10);
  assert.equal(DECISION_WEIGHTS.integration, 0.10);
  assert.equal(DECISION_WEIGHTS.maintainability, 0.05);
  const sum = Object.values(DECISION_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

// ── Scoring maths ───────────────────────────────────────────────────────
test('B8. recall counts only positive trials', () => {
  const trials = [
    trial({ expected: true, detected: true }),
    trial({ expected: true, detected: false }),
    trial({ expected: false, detected: false }),   // negative control, excluded
  ];
  assert.equal(recall(trials), 0.5);
});

test('B9. HACHIKO-critical scenarios are weighted double', () => {
  const critical = new Set(['extreme_yaw']);
  // Miss the critical case, pass the easy one.
  const bad = [
    trial({ scenarioId: 'extreme_yaw', detected: false }),
    trial({ scenarioId: 'frontal_seated', detected: true }),
  ];
  // Pass the critical case, miss the easy one.
  const good = [
    trial({ scenarioId: 'extreme_yaw', detected: true }),
    trial({ scenarioId: 'frontal_seated', detected: false }),
  ];
  assert.ok(recall(good, critical) > recall(bad, critical),
    'passing the hard case must score higher than passing the easy one');
  assert.equal(recall(bad, critical), 1 / 3);
  assert.equal(recall(good, critical), 2 / 3);
});

test('B10. false positives are counted on negative controls', () => {
  const trials = [
    trial({ expected: false, detected: true, falsePositive: true }),
    trial({ expected: false, detected: false }),
    trial({ expected: true, detected: true }),
  ];
  assert.equal(falsePositiveCount(trials), 1);
});

test('B11. mean true score ignores misses and negatives', () => {
  const trials = [
    trial({ expected: true, detected: true, maxScore: 0.8 }),
    trial({ expected: true, detected: false, maxScore: null }),
    trial({ expected: false, detected: false, maxScore: null }),
  ];
  assert.ok(Math.abs(meanTrueScore(trials) - 0.8) < 1e-9);
});

test('B12. latency and size scores decay as expected', () => {
  assert.equal(latencyScore(20), 1);         // within budget
  assert.equal(latencyScore(30), 1);         // at budget
  assert.ok(latencyScore(60) < 1 && latencyScore(60) > 0);
  assert.equal(latencyScore(90), 0);         // 3x budget
  assert.equal(sizeScore(5e6), 1);
  assert.ok(sizeScore(12e6) < 1);
  assert.equal(median([10, 20, 30]), 20);
});

test('B13. scoreCandidate combines components by the declared weights', () => {
  const perfect = scoreCandidate({
    modelId: 'x',
    // Positive at 0.9, negative control silent -> full separation.
    trials: [trial({ expected: true, detected: true, maxScore: 0.9, inferenceMs: 10 }),
             trial({ expected: false, detected: false, maxScore: null, inferenceMs: 10 })],
    sizeBytes: 5e6, integration: 1, maintainability: 1,
  });
  assert.ok(Math.abs(perfect.total - 1) < 1e-9, 'a flawless candidate scores 1');

  const missed = scoreCandidate({
    modelId: 'y',
    trials: [trial({ expected: true, detected: false, inferenceMs: 10 }),
             trial({ expected: false, detected: true, falsePositive: true, inferenceMs: 10 })],
    sizeBytes: 5e6, integration: 1, maintainability: 1,
  });
  assert.ok(missed.total < perfect.total);
  assert.equal(missed.stats.falsePositives, 1);
});

test('B14. rank orders best first', () => {
  const ranked = rank([{ total: 0.4 }, { total: 0.9 }, { total: 0.6 }]);
  assert.deepEqual(ranked.map((r) => r.total), [0.9, 0.6, 0.4]);
});

// ── Decision rules ──────────────────────────────────────────────────────
test('B15. RULE 1 - one capable detector wins on simplicity', () => {
  // Low ABSOLUTE scores, but positives separate cleanly from negatives.
  const good = () => taskMetrics([
    trial({ scenarioId: 'a', expected: true, detected: true, maxScore: 0.22 }),
    trial({ scenarioId: 'b', expected: true, detected: true, maxScore: 0.20 }),
    trial({ scenarioId: 'neg', expected: false, detected: false, maxScore: 0.01 }),
  ]);
  const d = decideStrategy({
    personByModel: { A: good() }, phoneByModel: { A: good() }, posePresence: good(),
  });
  assert.equal(d.strategy, 'ONE_MODEL');
  assert.equal(d.objectModel, 'A');
  assert.equal(d.presenceSource, 'OBJECT_DETECTOR_PERSON');
});

test('B16. RULE 2 - weak person + good phone recommends the split', () => {
  const weakPerson = taskMetrics([
    trial({ scenarioId: 'a', expected: true, detected: true, maxScore: 0.12 }),
    trial({ scenarioId: 'b', expected: true, detected: false, maxScore: null }),
    trial({ scenarioId: 'c', expected: true, detected: false, maxScore: null }),
    trial({ scenarioId: 'neg', expected: false, detected: false, maxScore: 0.01 }),
  ]);
  const strong = taskMetrics([
    trial({ scenarioId: 'a', expected: true, detected: true, maxScore: 0.70 }),
    trial({ scenarioId: 'b', expected: true, detected: true, maxScore: 0.65 }),
    trial({ scenarioId: 'neg', expected: false, detected: false, maxScore: 0.02 }),
  ]);
  const d = decideStrategy({
    personByModel: { A: weakPerson }, phoneByModel: { A: strong }, posePresence: strong,
  });
  assert.equal(d.strategy, 'SPLIT_MODEL');
  assert.equal(d.objectModel, 'A');
  assert.equal(d.presenceSource, 'POSE_LANDMARKER');
});

test('B17. NO universal confidence gate - low scores can still win', () => {
  // THE CORE FIX. Positives at ~0.20 with negatives at 0.01 are perfectly
  // usable via a model-specific threshold near 0.10. The old scorer demanded
  // mean confidence >= 0.35 and would have failed this, comparing uncalibrated
  // scores across model families as though they meant the same thing.
  const lowButClean = taskMetrics([
    trial({ scenarioId: 'a', expected: true, detected: true, maxScore: 0.20 }),
    trial({ scenarioId: 'b', expected: true, detected: true, maxScore: 0.18 }),
    trial({ scenarioId: 'neg', expected: false, detected: false, maxScore: 0.01 }),
  ]);
  assert.ok(lowButClean.meanTrueScore < 0.35, 'well under the old absolute gate');
  const d = decideStrategy({
    personByModel: { A: lowButClean }, phoneByModel: { A: lowButClean },
    posePresence: lowButClean,
  });
  assert.equal(d.strategy, 'ONE_MODEL',
    'separation, not absolute confidence, decides adequacy');
});

test('B18. high confidence cannot rescue poor separation', () => {
  // Positives 0.44, negatives 0.40: high absolute scores, useless margin.
  const highNoSeparation = taskMetrics([
    trial({ scenarioId: 'a', expected: true, detected: true, maxScore: 0.44 }),
    trial({ scenarioId: 'b', expected: true, detected: true, maxScore: 0.42 }),
    trial({ scenarioId: 'neg', expected: false, detected: true, falsePositive: true, maxScore: 0.40 }),
  ]);
  assert.ok(highNoSeparation.meanTrueScore > 0.35, 'would have passed the old gate');
  const d = decideStrategy({
    personByModel: { A: highNoSeparation }, phoneByModel: { A: highNoSeparation },
    posePresence: highNoSeparation,
  });
  assert.equal(d.strategy, 'INCONCLUSIVE');
});

test('B19. a false positive on a negative control is disqualifying', () => {
  const firesOnEmpty = taskMetrics([
    trial({ scenarioId: 'a', expected: true, detected: true, maxScore: 0.8 }),
    trial({ scenarioId: 'b', expected: true, detected: true, maxScore: 0.8 }),
    trial({ scenarioId: 'neg', expected: false, detected: true, falsePositive: true, maxScore: 0.6 }),
  ]);
  assert.equal(firesOnEmpty.specificity, 0);
  const d = decideStrategy({
    personByModel: { A: firesOnEmpty }, phoneByModel: { A: firesOnEmpty },
    posePresence: firesOnEmpty,
  });
  assert.equal(d.strategy, 'INCONCLUSIVE',
    'a presence signal that fires on an empty frame cannot be trusted');
});

test('B19b. pose is held to the same bar as any detector', () => {
  const strong = taskMetrics([
    trial({ scenarioId: 'a', expected: true, detected: true, maxScore: 0.7 }),
    trial({ scenarioId: 'neg', expected: false, detected: false, maxScore: 0.01 }),
  ]);
  const poseFiresOnEmpty = taskMetrics([
    trial({ scenarioId: 'a', expected: true, detected: true, maxScore: 0.9 }),
    trial({ scenarioId: 'neg', expected: false, detected: true, falsePositive: true, maxScore: 0.9 }),
  ]);
  const weakPerson = taskMetrics([
    trial({ scenarioId: 'a', expected: true, detected: false, maxScore: null }),
    trial({ scenarioId: 'neg', expected: false, detected: false, maxScore: 0 }),
  ]);
  const d = decideStrategy({
    personByModel: { A: weakPerson }, phoneByModel: { A: strong },
    posePresence: poseFiresOnEmpty,
  });
  assert.notEqual(d.strategy, 'SPLIT_MODEL',
    'an unreliable pose challenger cannot justify the split');
});

// -- Discriminability / confusion metrics --------------------------------
test('B25. separation reports the model-local positive/negative profile', () => {
  const sep = separation([
    trial({ expected: true, detected: true, maxScore: 0.30 }),
    trial({ expected: true, detected: true, maxScore: 0.20 }),
    trial({ expected: false, detected: false, maxScore: 0.05 }),
  ]);
  assert.equal(sep.minPositive, 0.20);
  assert.equal(sep.maxPositive, 0.30);
  assert.equal(sep.maxNegative, 0.05);
  assert.ok(Math.abs(sep.margin - 0.15) < 1e-9);
  assert.equal(sep.separable, true);
  assert.ok(sep.suggestedThreshold > 0.05 && sep.suggestedThreshold < 0.20,
    'the operating threshold sits inside the gap');
});

test('B26. an arithmetically positive but trivial margin is NOT separable', () => {
  // 0.42 over 0.40 is a ~5% relative gap - noise, not signal.
  const sep = separation([
    trial({ expected: true, detected: true, maxScore: 0.42 }),
    trial({ expected: false, detected: true, maxScore: 0.40 }),
  ]);
  assert.ok(sep.margin > 0, 'margin is positive...');
  assert.equal(sep.separable, false, '...but too small relative to the scores');
});

test('B27. discriminability is scale-free across model families', () => {
  const small = discriminability([
    trial({ expected: true, detected: true, maxScore: 0.20 }),
    trial({ expected: false, detected: false, maxScore: 0.02 }),
  ]);
  const large = discriminability([
    trial({ expected: true, detected: true, maxScore: 0.90 }),
    trial({ expected: false, detected: false, maxScore: 0.09 }),
  ]);
  assert.ok(Math.abs(small - large) < 0.02, `scale-free: ${small} vs ${large}`);
});

test('B28. confusion metrics are calculated', () => {
  const trials = [
    trial({ expected: true, detected: true }),
    trial({ expected: true, detected: false }),
    trial({ expected: false, detected: false }),
    trial({ expected: false, detected: true, falsePositive: true }),
  ];
  assert.equal(sensitivity(trials), 0.5);
  assert.equal(specificity(trials), 0.5);
  assert.equal(precision(trials), 0.5);
  assert.equal(falseNegativeCount(trials), 1);
  assert.equal(falsePositiveCount(trials), 1);
});

test('B29. pose and object confidences are never numerically compared', () => {
  const objectM = taskMetrics([
    trial({ modelId: 'obj', expected: true, detected: true, maxScore: 0.65 }),
    trial({ modelId: 'obj', expected: false, detected: false, maxScore: 0.02 }),
  ]);
  const poseM = taskMetrics([
    trial({ modelId: 'pose', task: 'pose', expected: true, detected: true, maxScore: 0.98 }),
    trial({ modelId: 'pose', task: 'pose', expected: false, detected: false, maxScore: 0 }),
  ]);
  // Both adequate despite very different score scales.
  const d = decideStrategy({
    personByModel: { obj: objectM }, phoneByModel: { obj: objectM }, posePresence: poseM,
  });
  assert.equal(d.strategy, 'ONE_MODEL');
  assert.notEqual(objectM.meanTrueScore, poseM.meanTrueScore);
});

// -- Stage 1 quick elimination -------------------------------------------
test('B30. quick verdicts are deterministic', () => {
  const trials = [
    trial({ scenarioId: 'frontal_seated', expected: true, detected: true, maxScore: 0.5 }),
    trial({ scenarioId: 'extreme_yaw', expected: true, detected: true, maxScore: 0.4 }),
    trial({ scenarioId: 'empty_frame', expected: false, detected: false, maxScore: 0.01 }),
  ];
  const a = quickVerdict(trials);
  const b = quickVerdict([...trials]);
  assert.equal(a.verdict, b.verdict);
  assert.deepEqual(a.reasons, b.reasons);
});

test('B31. ADVANCE on clean separation even at low absolute scores', () => {
  const v = quickVerdict([
    trial({ scenarioId: 'frontal_seated', expected: true, detected: true, maxScore: 0.20 }),
    trial({ scenarioId: 'extreme_yaw', expected: true, detected: true, maxScore: 0.18 }),
    trial({ scenarioId: 'back_facing', expected: true, detected: true, maxScore: 0.17 }),
    trial({ scenarioId: 'empty_frame', expected: false, detected: false, maxScore: 0.01 }),
  ]);
  assert.equal(v.verdict, 'ADVANCE');
});

test('B32. DROP when the model fires on the negative control', () => {
  const v = quickVerdict([
    trial({ scenarioId: 'frontal_seated', expected: true, detected: true, maxScore: 0.9 }),
    trial({ scenarioId: 'extreme_yaw', expected: true, detected: true, maxScore: 0.9 }),
    trial({ scenarioId: 'empty_frame', expected: false, detected: true, falsePositive: true, maxScore: 0.8 }),
  ]);
  assert.notEqual(v.verdict, 'ADVANCE');
  assert.ok(v.reasons.some((r) => /false positive/i.test(r)));
});

test('B33. DROP on very low recall regardless of confidence', () => {
  const v = quickVerdict([
    trial({ scenarioId: 'frontal_seated', expected: true, detected: true, maxScore: 0.95 }),
    trial({ scenarioId: 'extreme_yaw', expected: true, detected: false, maxScore: null }),
    trial({ scenarioId: 'back_facing', expected: true, detected: false, maxScore: null }),
    trial({ scenarioId: 'empty_frame', expected: false, detected: false, maxScore: 0 }),
  ], new Set(['extreme_yaw', 'back_facing', 'empty_frame']));
  assert.equal(v.verdict, 'DROP');
});

test('B34. BORDERLINE sits between the two', () => {
  const v = quickVerdict([
    trial({ scenarioId: 'a', expected: true, detected: true, maxScore: 0.30 }),
    trial({ scenarioId: 'b', expected: true, detected: true, maxScore: 0.28 }),
    trial({ scenarioId: 'c', expected: true, detected: false, maxScore: null }),
    trial({ scenarioId: 'neg', expected: false, detected: false, maxScore: 0.24 }),
  ]);
  assert.equal(v.verdict, 'BORDERLINE');
});

test('B35. critical scenarios keep double weight in quick verdicts', () => {
  const critical = new Set(['extreme_yaw']);
  const missedCritical = [
    trial({ scenarioId: 'extreme_yaw', expected: true, detected: false, maxScore: null }),
    trial({ scenarioId: 'frontal_seated', expected: true, detected: true, maxScore: 0.5 }),
    trial({ scenarioId: 'empty_frame', expected: false, detected: false, maxScore: 0.01 }),
  ];
  const missedEasy = [
    trial({ scenarioId: 'extreme_yaw', expected: true, detected: true, maxScore: 0.5 }),
    trial({ scenarioId: 'frontal_seated', expected: true, detected: false, maxScore: null }),
    trial({ scenarioId: 'empty_frame', expected: false, detected: false, maxScore: 0.01 }),
  ];
  assert.ok(recall(missedEasy, critical) > recall(missedCritical, critical));
});

test('B36. per-candidate verdict takes the WORST task verdict', () => {
  const byModelTask = {
    'A|person': [
      trial({ scenarioId: 'frontal_seated', expected: true, detected: true, maxScore: 0.6 }),
      trial({ scenarioId: 'empty_frame', expected: false, detected: false, maxScore: 0.01 }),
    ],
    'A|phone': [
      trial({ scenarioId: 'study_distance', expected: true, detected: false, maxScore: null }),
      trial({ scenarioId: 'on_desk', expected: true, detected: false, maxScore: null }),
      trial({ scenarioId: 'no_phone', expected: false, detected: false, maxScore: 0 }),
    ],
  };
  const out = quickVerdictByCandidate(byModelTask);
  assert.equal(out.A.verdict, 'DROP',
    'a detector useless for phone does not advance on person alone');
  assert.equal(out.A.tasks.person.verdict, 'ADVANCE');
});

test('B37. quick criteria contain no absolute confidence gate', () => {
  const keys = Object.keys(QUICK_CRITERIA).join(' ');
  assert.ok(!/CONFIDENCE|MEAN_SCORE/i.test(keys),
    `quick criteria must not gate on absolute confidence: ${keys}`);
  assert.ok('ADVANCE_MIN_DISCRIMINABILITY' in QUICK_CRITERIA);
});

// ── Runner mechanics ────────────────────────────────────────────────────
test('B20. peak-hold takes the best score across the window', () => {
  const obs = (p, h, ms) => ({
    personMaxScore: p, personDetected: p !== null,
    phoneMaxScore: h, phoneDetected: h !== null, inferenceMs: ms,
  });
  const best = BenchmarkRunner.peak([obs(0.2, null, 10), obs(0.7, 0.4, 20), obs(0.3, 0.1, 30)]);
  assert.equal(best.personMaxScore, 0.7);
  assert.equal(best.phoneMaxScore, 0.4);
  assert.equal(best.inferenceMs, 20, 'median latency, not the best case');
});

test('B21. recordTrial marks a detection on a negative control as a false positive', () => {
  const runner = new BenchmarkRunner({});
  const t = runner.recordTrial({
    task: 'person', scenarioId: 'empty_frame', expected: false,
    observation: {
      modelId: 'A', personDetected: true, personMaxScore: 0.6,
      phoneDetected: false, phoneMaxScore: null, inferenceMs: 25, delegate: 'GPU',
    },
  });
  assert.equal(t.falsePositive, true);
  assert.equal(t.detected, true);
  assert.equal(runner.getTrials().length, 1);
});

test('B22. exported results contain no imagery', () => {
  const runner = new BenchmarkRunner({});
  runner.recordTrial({
    task: 'phone', scenarioId: 'on_desk', expected: true,
    observation: {
      modelId: 'A', personDetected: false, personMaxScore: null,
      phoneDetected: true, phoneMaxScore: 0.7, inferenceMs: 22, delegate: 'GPU',
    },
  });
  const json = runner.toJSON();
  for (const banned of ['ImageData', 'data:image', 'blob:', 'canvas', 'pixels']) {
    assert.ok(!json.includes(banned), `export must not contain ${banned}`);
  }
  assert.ok(json.includes('on_desk'));
});

test('B23. markdown table renders the required columns', () => {
  const md = toMarkdownTable([trial({ modelId: 'edl2-f16', scenarioId: 'on_desk' })]);
  for (const col of ['Model', 'Task', 'Scenario', 'Detected?', 'Max score',
                     'False positive?', 'Inference ms']) {
    assert.ok(md.includes(col), `missing column ${col}`);
  }
  assert.ok(md.includes('edl2-f16'));
});

// ── Isolation from production ───────────────────────────────────────────
test('B24. the benchmark is isolated from the production AI core', () => {
  // Production config must expose no benchmark concepts.
  assert.equal(CONFIG.objectDetector.benchmarkMode, undefined);
  assert.equal(CONFIG.benchmark, undefined);
  // And production still points at its own model.
  assert.ok(CONFIG.objectDetector.modelAssetPath.includes('efficientdet_lite0.tflite'));
  assert.ok(!CONFIG.objectDetector.modelAssetPath.includes('/bench/'));
});
