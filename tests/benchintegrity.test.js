/**
 * Benchmark reporting integrity (spec §K/§L/§T/§U/§AD/§AE).
 *
 * The rule under test: ONE canonical evidence source. Recorded trial data is
 * the truth; the dashboard, the JSON and the workbook are projections of it.
 * No layer may score independently, and no layer may choose a winner.
 *
 * These tests exist because the failures they guard are silent. A dashboard
 * that computes recall its own way agrees with the report until the day it
 * does not, and an extra repetition inflates an aggregate without ever
 * looking wrong.
 *
 * No AI parameter is read or changed here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BenchmarkRunner } from '../tools/benchmark/BenchmarkRunner.js';
import {
  buildModelSummaries, buildScenarioSummaries, buildResultsJson,
  buildEvidenceReadiness, partitionFormalSet, benchmarkCompletion,
  requiredScenarios, EvaluationStatus, SELECTION_NOTE,
  MODEL_SUMMARY_COLUMNS,
} from '../tools/benchmark/exportResults.js';
import {
  CANDIDATES, PERSON_SCENARIOS, BENCH_SCORE_THRESHOLD,
} from '../tools/benchmark/candidates.js';

const OPT = { requiredRepetitions: 3 };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = () => read('../public/benchmark.html');

const obs = (o = {}) => ({
  task: 'object', rawCount: 1, detections: [],
  personDetected: true, personMaxScore: 0.9,
  phoneDetected: false, phoneMaxScore: null,
  topOther: [], inferenceMs: 12, modelId: 'edl0-f16', delegate: 'GPU', ...o,
});

/** Record `n` repetitions of one scenario through the real runner. */
function record(r, scenarioId, expected, n, o = {}) {
  for (let i = 0; i < n; i++) {
    r.recordTrial({
      task: 'person', scenarioId, expected,
      observation: obs(expected ? o : { personDetected: false, personMaxScore: null, ...o }),
    });
  }
}

/** A runner with the full PERSON protocol satisfied exactly once. */
function completePerson() {
  const r = new BenchmarkRunner({});
  for (const s of PERSON_SCENARIOS) record(r, s.id, s.expect, 3);
  return r;
}

// ═══════════════════════════════════════════════════════════════════════
// §T — trial accounting invariants
// ═══════════════════════════════════════════════════════════════════════
test('B1. attempts = evaluable + invalid/error', () => {
  const r = new BenchmarkRunner({});
  record(r, 'frontal_seated', true, 2);
  r.recordInvalidAttempt({ task: 'person', scenarioId: 'frontal_seated',
    reason: 'no bounded samples captured' });
  r.recordInvalidAttempt({ task: 'person', scenarioId: 'frontal_seated',
    reason: 'MODEL_INIT_ERROR' });

  const s = r.getAttemptSummary();
  assert.equal(s.evaluableTrials, 2);
  assert.equal(s.invalidAttempts, 2);
  assert.equal(s.totalAttempts, s.evaluableTrials + s.invalidAttempts);
});

test('B2. TP + TN + FP + FN = evaluable', () => {
  const r = completePerson();
  const row = buildModelSummaries(r.getTrials(), OPT)
    .find((x) => x.task === 'person');
  assert.equal(row.tp + row.tn + row.fp + row.fn, row.totalValidTrials);
  // And the evaluable count is the formal set, not everything ever recorded.
  assert.equal(row.totalValidTrials, PERSON_SCENARIOS.length * 3);
});

test('B3. an invalid attempt does not fill one of the three repetitions', () => {
  const r = new BenchmarkRunner({});
  record(r, 'frontal_seated', true, 2);
  r.recordInvalidAttempt({ task: 'person', scenarioId: 'frontal_seated',
    reason: 'inference error' });

  const sc = buildScenarioSummaries(r.getTrials(), OPT)[0];
  assert.equal(sc.repetitionsCompleted, 2, 'the invalid attempt earns no credit');
  assert.equal(sc.complete, false);
});

test('B4. a rerun completes the set without erasing the invalid attempt', () => {
  const r = new BenchmarkRunner({});
  record(r, 'frontal_seated', true, 2);
  r.recordInvalidAttempt({ task: 'person', scenarioId: 'frontal_seated',
    reason: 'no sample' });
  record(r, 'frontal_seated', true, 1);          // the replacement run

  const sc = buildScenarioSummaries(r.getTrials(), OPT)[0];
  assert.equal(sc.repetitionsCompleted, 3, 'the scenario is now complete');
  assert.equal(r.getInvalidAttempts().length, 1,
    'and the failed attempt is still on the record');
  assert.equal(r.getAttemptSummary().totalAttempts, 4);
});

// ═══════════════════════════════════════════════════════════════════════
// §U / §V — extra repetitions, and the 100% cap
// ═══════════════════════════════════════════════════════════════════════
test('B5. extra repetitions are retained but excluded from the aggregate', () => {
  const r = new BenchmarkRunner({});
  // Three clean detections, then two retries that happened to miss.
  record(r, 'frontal_seated', true, 3);
  record(r, 'frontal_seated', true, 2, { personDetected: false, personMaxScore: null });

  const { formal, extra } = partitionFormalSet(r.getTrials(), 3);
  assert.equal(formal.length, 3, 'the formal set is the first three');
  assert.equal(extra.length, 2, 'the extras survive as evidence');

  const row = buildModelSummaries(r.getTrials(), OPT)
    .find((x) => x.task === 'person');
  // Had the extras been pooled, tp would be 3 and fn 2.
  assert.equal(row.tp, 3);
  assert.equal(row.fn, 0, 'retries must not dilute the formal aggregate');
  assert.equal(row.totalValidTrials, 3);
  assert.equal(row.extraTrials, 2, 'and they are reported, not hidden');
});

test('B5b. the formal set is the first 3 EVALUABLE, not the first 3 attempts', () => {
  // The distinction only shows when invalid attempts come FIRST and BETWEEN
  // the valid ones. If the partition counted attempts, the failures would
  // eat formal slots and the scenario would look complete at one real trial.
  const r = new BenchmarkRunner({});
  r.recordInvalidAttempt({ task: 'person', scenarioId: 'frontal_seated',
    reason: 'no bounded samples' });                       // attempt 1: invalid
  record(r, 'frontal_seated', true, 1);                    // attempt 2: valid
  r.recordInvalidAttempt({ task: 'person', scenarioId: 'frontal_seated',
    reason: 'MODEL_INIT_ERROR' });                         // attempt 3: invalid
  record(r, 'frontal_seated', true, 2);                    // attempts 4-5: valid
  // A 4th VALID repetition: this one IS an extra.
  record(r, 'frontal_seated', true, 1, { personDetected: false, personMaxScore: null });

  const { formal, extra } = partitionFormalSet(r.getTrials(), 3);
  assert.equal(formal.length, 3, 'three evaluable trials fill the formal set');
  assert.equal(extra.length, 1, 'only the 4th VALID trial is extra');

  // Invalid attempts are structurally incapable of entering: they live in a
  // separate array that the partition never reads.
  assert.equal(r.getInvalidAttempts().length, 2, 'both failures are retained');
  assert.equal(r.getTrials().length, 4, 'and none of them became a trial');
  assert.equal(r.getAttemptSummary().totalAttempts, 6);

  // The scenario is complete on EVALUABLE count, and the 4th miss is excluded.
  const sc = buildScenarioSummaries(r.getTrials(), OPT)[0];
  assert.equal(sc.repetitionsCompleted, 3);
  const row = buildModelSummaries(r.getTrials(), OPT)[0];
  assert.equal(row.tp, 3);
  assert.equal(row.fn, 0, 'the extra miss must not enter the aggregate');
  assert.equal(row.totalValidTrials, 3);
});

test('B6. completeness cannot exceed 100%', () => {
  const r = completePerson();
  record(r, 'frontal_seated', true, 4);          // a heavily retried scenario
  const row = buildModelSummaries(r.getTrials(), OPT)
    .find((x) => x.task === 'person');
  assert.equal(row.coverage, 1);
  assert.ok(row.coverage <= 1, 'coverage is capped');
  assert.equal(row.scenariosCompleted, row.scenariosRequired);
});

test('B7. expected counts derive from the registries, never a literal', () => {
  // Adding YOLO26n must move the expected totals without a code edit.
  const objectCandidates = CANDIDATES.filter((c) => c.task === 'object').length;
  const completion = benchmarkCompletion([], OPT);
  const expected = CANDIDATES.reduce((n, c) =>
    n + (c.task === 'pose' ? 1 : 2), 0);
  assert.equal(completion.perCandidate.length, expected,
    'one row per candidate x task, derived from the registry');
  assert.ok(objectCandidates >= 4, 'YOLO26n is counted among them');
  assert.equal(requiredScenarios('person').length, PERSON_SCENARIOS.length);
});

// ═══════════════════════════════════════════════════════════════════════
// §AE — Scenario Results reconcile with Model Comparison
// ═══════════════════════════════════════════════════════════════════════
test('B8. scenario rows sum exactly to the aggregate confusion counts', () => {
  const r = completePerson();
  const trials = r.getTrials();
  const row = buildModelSummaries(trials, OPT).find((x) => x.task === 'person');
  const scenarios = buildScenarioSummaries(trials, OPT)
    .filter((s) => s.task === 'person');

  // Every formal trial appears in exactly one scenario row.
  const scenarioTrials = scenarios.reduce((n, s) => n + s.repetitionsCompleted, 0);
  assert.equal(scenarioTrials, row.totalValidTrials);
  assert.equal(scenarios.length, requiredScenarios('person').length);
  assert.equal(row.tp + row.tn + row.fp + row.fn, scenarioTrials);
});

// ═══════════════════════════════════════════════════════════════════════
// §AD / §AF — dashboard, JSON and XLSX read the same numbers
// ═══════════════════════════════════════════════════════════════════════
test('B9. the JSON carries the model summaries the dashboard renders', () => {
  const trials = completePerson().getTrials();
  const doc = buildResultsJson(trials, OPT);
  const dash = buildModelSummaries(trials, OPT).find((x) => x.task === 'person');
  const json = doc.modelSummaries.find((x) => x.task === 'person');

  // Same object source, so every metric a reader compares must agree.
  for (const k of ['recall', 'specificity', 'precision', 'tp', 'tn', 'fp', 'fn',
    'medianInferenceMs', 'p95InferenceMs', 'modelSizeBytes',
    'evaluationStatus', 'coverage', 'runtime', 'delegate',
    'modelInputWidth', 'modelInputHeight']) {
    assert.deepEqual(json[k], dash[k], `${k} must match between JSON and dashboard`);
  }
});

test('B10. the workbook projects the JSON rather than rescoring', () => {
  const src = read('../tools/benchmark/benchmarkReport.js');
  // The report may format and lay out; it may not compute a verdict.
  for (const banned of ['taskMetrics(', 'confusion(', 'finalRank', 'RECOMMENDED']) {
    assert.ok(!src.includes(banned),
      `the workbook must not compute "${banned}" — it projects the JSON`);
  }
});

test('B11. computing metadata survives into the export columns', () => {
  for (const col of ['model_size_mb', 'model_input_w', 'model_input_h',
    'runtime', 'delegate', 'inference_p50_ms', 'inference_p95_ms',
    'model_load_ms', 'warmup_ms']) {
    assert.ok(MODEL_SUMMARY_COLUMNS.includes(col), `missing column ${col}`);
  }
  // Load/warm-up must stay SEPARATE from steady-state latency.
  assert.ok(MODEL_SUMMARY_COLUMNS.includes('model_load_ms'));
  assert.notEqual(
    MODEL_SUMMARY_COLUMNS.indexOf('model_load_ms'),
    MODEL_SUMMARY_COLUMNS.indexOf('inference_p50_ms'));
});

// ═══════════════════════════════════════════════════════════════════════
// §L / §M / §Q — nothing ranks, nothing wins, nothing is recommended
// ═══════════════════════════════════════════════════════════════════════
test('B12. no summary row carries a rank or a recommendation', () => {
  const rows = buildModelSummaries(completePerson().getTrials(), OPT);
  for (const r of rows) {
    for (const banned of ['finalRank', 'finalRecommendation', 'rank', 'winner',
      'recommended', 'overallScore', 'weightedScore']) {
      assert.ok(!(banned in r), `summary must not carry "${banned}"`);
    }
    assert.ok(Object.values(EvaluationStatus).includes(r.evaluationStatus));
  }
});

test('B13. evidence readiness names no model, however complete the data', () => {
  const rec = buildEvidenceReadiness(completePerson().getTrials(), OPT);
  for (const banned of ['strategy', 'presenceModel', 'phoneModel', 'rationale',
    'winner', 'recommendation']) {
    assert.ok(!(banned in rec), `readiness must not carry "${banned}"`);
  }
  assert.ok('perTask' in rec, 'it reports coverage per task instead');
  assert.equal(rec.selectionNote, SELECTION_NOTE);
});

test('B14. the exported JSON recommends nothing', () => {
  const doc = buildResultsJson(completePerson().getTrials(), OPT);
  assert.ok(!('recommendation' in doc));
  assert.ok('evidenceReadiness' in doc);
  const json = JSON.stringify(doc);
  assert.ok(!/"finalRank"/.test(json), 'no rank survives into the JSON');
  assert.ok(!/"RECOMMENDED"/.test(json), 'and no winner label');
});

test('B15. model order is the registry, and never performance', () => {
  const r = new BenchmarkRunner({});
  // Give the LATER candidate the better evidence: a performance sort would
  // hoist it above the earlier one.
  for (const s of PERSON_SCENARIOS) {
    for (let i = 0; i < 3; i++) {
      r.recordTrial({ task: 'person', scenarioId: s.id, expected: s.expect,
        observation: obs({ modelId: 'edl0-f16',
          personDetected: s.expect ? Math.random() > 2 : false,
          personMaxScore: null }) });
    }
  }
  for (const s of PERSON_SCENARIOS) {
    for (let i = 0; i < 3; i++) {
      r.recordTrial({ task: 'person', scenarioId: s.id, expected: s.expect,
        observation: obs({ modelId: 'edl2-f16',
          personDetected: s.expect, personMaxScore: s.expect ? 0.95 : null }) });
    }
  }
  const order = buildModelSummaries(r.getTrials(), OPT)
    .filter((x) => x.task === 'person').map((x) => x.model);
  const registry = CANDIDATES.map((c) => c.id).filter((id) => order.includes(id));
  assert.deepEqual(order, registry,
    'the stronger candidate must not be hoisted to the top row');
});

test('B16. the dashboard shows no rank column and no winner panel', () => {
  const html = page();
  assert.ok(!/<th>\s*Rank\s*<\/th>/i.test(html), 'no rank column header');
  assert.ok(!html.includes('Final perception selection'),
    'the automatic selection panel is gone');
  assert.ok(!html.includes('buildRecommendation'),
    'the dashboard no longer calls the recommender');
  assert.ok(!/RANK \$\{/.test(html), 'no rank is rendered into a cell');
  // The replacement wording must be present, verbatim.
  assert.ok(html.includes('task-specific trade-offs'));
});

// ═══════════════════════════════════════════════════════════════════════
// §R / §S — the diagnostic floor is a floor, not an operating point
// ═══════════════════════════════════════════════════════════════════════
test('B17. the score floor is labelled diagnostic everywhere it appears', () => {
  const doc = buildResultsJson(completePerson().getTrials(), OPT);
  const row = doc.modelSummaries[0];
  assert.equal(row.metricBasis ?? doc.configuration?.metricBasis ?? 'DIAGNOSTIC_FLOOR',
    'DIAGNOSTIC_FLOOR');
  // It is never presented as a chosen operating threshold.
  const json = JSON.stringify(doc);
  assert.ok(!/"operatingThreshold":\s*0\.05/.test(json),
    'the diagnostic floor must not masquerade as an operating threshold');
  assert.equal(BENCH_SCORE_THRESHOLD, 0.05);
});

test('B18. the diagnostic floor selects no model', () => {
  const src = read('../tools/benchmark/exportResults.js');
  // It may be reported; it may not gate a choice.
  assert.ok(!/BENCH_SCORE_THRESHOLD\s*[<>]/.test(src),
    'the floor must not be compared to pick a candidate');
});

test('B19. raw confidence is never normalised across model families', () => {
  const src = read('../tools/benchmark/score.js')
    + read('../tools/benchmark/exportResults.js');
  for (const banned of ['normaliseAcrossModels', 'calibratedProbability',
    'crossModelScore']) {
    assert.ok(!src.includes(banned), `must not ${banned}`);
  }
  // Separation is computed per candidate/task group, never pooled.
  const rows = buildModelSummaries(completePerson().getTrials(), OPT);
  assert.ok(rows.every((r) => r.model && r.task),
    'every metric row is scoped to one model and one task');
});

// ═══════════════════════════════════════════════════════════════════════
// Live diagnostics vs. recording — two independent gates
// ═══════════════════════════════════════════════════════════════════════
// The bug this guards: the async (LiteRT) candidate produced no live
// inference at all, because the camera loop only ever called the
// synchronous `observe`. The page showed "yolo26n ready (webgpu)" and
// "no model loaded" at the same time, with every panel stuck on
// "Waiting for camera".
test('B20. the camera loop drives BOTH the sync and async runtimes', () => {
  const html = page();
  const js = html.slice(html.indexOf('<script type="module">'));
  const loop = js.slice(js.indexOf('function loop()'),
    js.indexOf('requestAnimationFrame(loop)'));

  assert.match(loop, /runner\.observeAsync\(/,
    'the loop must run async inference for the LiteRT candidate');
  assert.match(loop, /runner\.observe\(/,
    'and keep the synchronous path for the MediaPipe candidates');
  // One inference in flight at a time: a slow backend must not queue a new
  // predict on every animation frame.
  assert.match(loop, /pendingAsync/, 'in-flight inference is tracked');
});

test('B21. live inference is gated by model+camera, never by a scenario', () => {
  const html = page();
  const js = html.slice(html.indexOf('<script type="module">'));
  const loop = js.slice(js.indexOf('function loop()'),
    js.indexOf('requestAnimationFrame(loop)'));

  // `running` (camera) is the only guard at the top of the loop.
  assert.match(loop, /^\s*if \(!running\) return;/m);
  // The inference call itself must not sit behind a scenario or a recording
  // check. `selected?.id` may still be READ for the status label — that is
  // display, not a gate — so this targets the guards, not every mention.
  // Strip comments: the prologue EXPLAINS that a scenario must not gate
  // inference, and a naive scan would flag that prose as the thing it warns
  // against.
  const infer = loop.slice(0, Math.max(loop.indexOf('runner.observe('),
    loop.indexOf('runner.observeAsync(')))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const gate of [/if\s*\([^)]*selected[^)]*\)\s*(return|\{)/,
    /if\s*\([^)]*isRecording\(\)[^)]*\)\s*(return|\{)/,
    /if\s*\([^)]*scenario[^)]*\)\s*return/]) {
    assert.ok(!gate.test(infer),
      `live inference must not be gated by ${gate}`);
  }
  // The only early return before inference is the camera check. (Counted on
  // the uncommented loop, since the guard shares its line with other code.)
  assert.match(loop, /if \(!running\) return;/,
    'camera state guards the loop');
  const bareReturns = infer.match(/(^|[;{}\s])return\s*;/g) ?? [];
  assert.ok(bareReturns.length <= 1,
    `camera state must be the sole early return, found ${bareReturns.length}`);
});

test('B22. model identity is rendered from load state, not from a detection', () => {
  const html = page();
  const js = html.slice(html.indexOf('<script type="module">'));
  const loop = js.slice(js.indexOf('function loop()'),
    js.indexOf('requestAnimationFrame(loop)'));
  // It must be set OUTSIDE the `if (obs)` branch, or a candidate that is
  // loaded but not yet producing frames reads "no model loaded".
  const objBranch = loop.indexOf('if (obs) {');
  const ctx = loop.indexOf("$('insCtx')");
  assert.ok(ctx >= 0 && ctx < objBranch,
    'insCtx must be updated before, and independently of, any observation');
  // And exactly one place may own it.
  assert.equal((js.match(/\$\('insCtx'\)\.textContent =/g) ?? []).length, 1);
});

test('B23. stopping the camera and switching models clear async carry-over', () => {
  const html = page();
  const js = html.slice(html.indexOf('<script type="module">'));
  const stop = js.slice(js.indexOf("$('btnStop').onclick"),
    js.indexOf("$('btnStop').onclick") + 700);
  assert.match(stop, /asyncObs = null/,
    'a promise landing after Stop must not render into the next session');
  assert.match(stop, /pendingAsync = false/);
  // Switching candidates must not show the previous model's observation.
  const load = js.slice(js.indexOf('const e = await runner.load(c.id);'),
    js.indexOf('const e = await runner.load(c.id);') + 500);
  assert.match(load, /asyncObs = null/);
  assert.match(load, /lat\.length = 0/, 'latency history is per candidate');
});

test('B24. live observation never records a trial on its own', () => {
  // The runtime invariant behind B20-B23: observing is not recording. Only
  // recordTrial appends, and the live loop never calls it.
  const r = new BenchmarkRunner({});
  assert.equal(r.getTrials().length, 0);

  const html = page();
  const js = html.slice(html.indexOf('<script type="module">'));
  const loop = js.slice(js.indexOf('function loop()'),
    js.indexOf('requestAnimationFrame(loop)'));
  assert.ok(!loop.includes('recordTrial('),
    'the live loop must never commit a trial');
  // offerSample is the single storage gate, and it is bounded by the
  // controller's recording window.
  assert.match(loop, /trials\.offerSample\(/);
  assert.equal((js.match(/runner\.recordTrial\(/g) ?? []).length, 1,
    'exactly one commit path, in onTrialComplete');
});

test('B25. Model Comparison distinguishes the per-task rows', () => {
  // One candidate produces one row PER TASK (presence and phone are measured
  // separately). Without a Task column those rows render identically and
  // read as a duplicate — which is what an operator reported seeing.
  const r = new BenchmarkRunner({});
  r.recordTrial({ task: 'person', scenarioId: 'frontal_seated', expected: true,
    observation: obs({ modelId: 'edl0-f16' }) });
  r.recordTrial({ task: 'phone', scenarioId: 'screen_portrait', expected: true,
    observation: obs({ modelId: 'edl0-f16', phoneDetected: true, phoneMaxScore: 0.8 }) });

  const rows = buildModelSummaries(r.getTrials(), OPT);
  assert.equal(rows.length, 2, 'one row per model x task');
  assert.deepEqual(rows.map((x) => x.model), ['edl0-f16', 'edl0-f16']);
  assert.deepEqual(rows.map((x) => x.task).sort(), ['person', 'phone'],
    'the rows differ only by task, so the table must show it');

  const html = page();
  const head = html.slice(html.indexOf('id="tabModel"'), html.indexOf('id="rankBody"'));
  assert.match(head, /<th[^>]*>Task<\/th>/,
    'the comparison table needs a Task column to tell the rows apart');

  // Header and body must agree, or every cell after the insertion shifts.
  const i = html.indexOf("rankBody').innerHTML");
  const tr = html.slice(html.indexOf('return `<tr', i), html.indexOf('</tr>', i));
  assert.equal((head.match(/<th[ >]/g) ?? []).length,
    (tr.match(/<td[ >]/g) ?? []).length,
    'header and body column counts must match');
  // And the empty state must span the whole table.
  assert.match(html, /colspan="12" class="dimval">No trials recorded yet/);
});
