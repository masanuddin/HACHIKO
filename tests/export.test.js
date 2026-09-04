/**
 * UI/export tests — research-data integrity for the testing dashboards.
 *
 * The UI redesign is only safe if the DATA it produces stays complete and
 * trustworthy. These tests cover the export contract, repetition bookkeeping,
 * and the privacy invariant — the parts a visual redesign could silently break.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BenchmarkRunner } from '../tools/benchmark/BenchmarkRunner.js';
import {
  buildTrialsCsv, buildScenarioSummaryCsv, buildModelSummaryCsv,
  buildExportBundle, buildModelSummaries, buildRecommendation,
  benchmarkCompletion, assertNoImagery,
  TRIAL_COLUMNS, SCENARIO_SUMMARY_COLUMNS, MODEL_SUMMARY_COLUMNS,
} from '../tools/benchmark/exportResults.js';
import { DEBUG_HELP, BENCH_HELP } from '../tools/shared/help.js';
import * as configModule from '../src/ai/index.js';
import { SCENARIO_GUIDE } from '../tools/debug/help.js';
import { PERSON_SCENARIOS, PHONE_SCENARIOS } from '../tools/benchmark/candidates.js';
import { ScenarioTruth, CONFIG } from '../src/ai/index.js';

const url = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(url(p), 'utf8');

/** Observation shaped like real runner output. */
const obs = (over = {}) => ({
  modelId: 'edl2-f16', personDetected: true, personMaxScore: 0.42,
  phoneDetected: false, phoneMaxScore: null, inferenceMs: 31, delegate: 'GPU',
  rawCount: 4, videoWidth: 640, videoHeight: 480,
  topOther: [{ categoryName: 'remote', score: 0.08, index: 65 }], ...over,
});

function seeded() {
  const r = new BenchmarkRunner({});
  for (let i = 0; i < 3; i++) {
    r.recordTrial({ task: 'person', scenarioId: 'frontal_seated', expected: true, observation: obs(), stage: 1 });
  }
  for (let i = 0; i < 3; i++) {
    r.recordTrial({
      task: 'person', scenarioId: 'empty_frame', expected: false, stage: 1,
      observation: obs({ personDetected: false, personMaxScore: null, rawCount: 0, topOther: [] }),
    });
  }
  return r;
}

// ── Repetition bookkeeping ──────────────────────────────────────────────
test('U1. repetition auto-increments per model+task+scenario', () => {
  const r = seeded();
  const reps = r.getTrials()
    .filter((t) => t.scenarioId === 'frontal_seated').map((t) => t.repetition);
  assert.deepEqual(reps, [1, 2, 3], 'the tester never numbers trials by hand');
});

test('U2. repetitions are independent across scenario, task and model', () => {
  const r = new BenchmarkRunner({});
  r.recordTrial({ task: 'person', scenarioId: 'a', expected: true, observation: obs() });
  r.recordTrial({ task: 'person', scenarioId: 'b', expected: true, observation: obs() });
  r.recordTrial({ task: 'phone', scenarioId: 'a', expected: true, observation: obs() });
  r.recordTrial({ task: 'person', scenarioId: 'a', expected: true, observation: obs({ modelId: 'edl0-f16' }) });
  for (const t of r.getTrials()) {
    assert.equal(t.repetition, 1, `${t.trialId} should be its own first repetition`);
  }
});

test('U3. progressFor reports completion and the next scenario', () => {
  const r = seeded();
  // Official method evaluates the FULL scenario set, not a quick subset.
  const p = r.progressFor('edl2-f16', 'person', PERSON_SCENARIOS);
  assert.equal(p.scenariosTotal, PERSON_SCENARIOS.length);
  assert.equal(p.scenariosComplete, 2, 'frontal_seated and empty_frame are 3 of 3');
  assert.equal(p.trialsDone, 6);
  assert.equal(p.trialsRequired, PERSON_SCENARIOS.length * 3);
  assert.equal(p.allComplete, false);
  assert.ok(p.nextScenario, 'an incomplete scenario is suggested');
  assert.ok(!['frontal_seated', 'empty_frame'].includes(p.nextScenario.scenarioId));
});

test('U4. Delete Last Trial removes the trial literally and rolls back', () => {
  const r = seeded();
  const last = r.lastTrial();
  const removed = r.deleteLastTrial();

  assert.ok(removed);
  assert.equal(removed.trialId, last.trialId, 'it removes the MOST RECENT trial');
  assert.equal(r.getTrials().length, 5, 'the row is gone, not flagged');
  assert.ok(!r.getTrials().some((t) => t.trialId === last.trialId));
  assert.equal(r.discarded, undefined, 'no tombstone list is retained');
  assert.equal(r.repetitionCount('edl2-f16', 'person', 'empty_frame'), 2,
    'progress rolls back');
});

test('U5. negative controls carry explicit metadata', () => {
  const r = seeded();
  const neg = r.getTrials().find((t) => t.scenarioId === 'empty_frame');
  assert.equal(neg.scenarioType, 'negative_control');
  assert.equal(neg.expectedTargetPresent, false);
  assert.equal(neg.falsePositive, false, 'nothing detected on an empty frame');
  const pos = r.getTrials().find((t) => t.scenarioId === 'frontal_seated');
  assert.equal(pos.scenarioType, 'positive');
  assert.equal(pos.expectedTargetPresent, true);
  assert.equal(pos.falseNegative, false);
});

test('U6. model, task and stage metadata are recorded on every trial', () => {
  const r = seeded();
  for (const t of r.getTrials()) {
    assert.equal(t.modelId, 'edl2-f16');
    assert.equal(t.task, 'person');
    assert.equal(t.stage, 1);
    assert.ok(t.trialId && t.sessionId && t.recordedAtIso);
    assert.ok(Number.isFinite(t.inferenceMs));
  }
});

test('U7. competing class is captured for diagnosis', () => {
  const r = seeded();
  const pos = r.getTrials().find((t) => t.scenarioId === 'frontal_seated');
  assert.equal(pos.competingClass, 'remote');
  assert.ok(Math.abs(pos.competingScore - 0.08) < 1e-9);
});

// ── results.json completeness ───────────────────────────────────────────
test('U8. benchmark export is ONE archive of exactly three files', () => {
  const r = seeded();
  const bundle = buildExportBundle({
    trials: r.getTrials(),
    session: { sessionId: r.sessionId, requiredRepetitions: 3,
               startedIso: '2026-09-04T00:00:00.000Z', userAgent: 'test-agent' },
  });
  const names = bundle.files.map((f) => f.name).sort();
  assert.deepEqual(names,
    ['benchmark_results.json', 'benchmark_summary.csv', 'benchmark_trials.csv']);
  assert.match(bundle.archiveName,
    /^hachiko_benchmark_results_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}\.zip$/);
  // Per-scenario detail is not lost: it moves into the JSON rather than
  // becoming a fourth CSV for the tester to reassemble.
  assert.ok(!names.includes('benchmark_scenario_summary.csv'));

  const doc = JSON.parse(bundle.files.find((f) => /\.json$/.test(f.name)).content);
  for (const k of ['schemaVersion', 'exportMetadata', 'environment', 'session',
                   'configuration', 'candidates', 'scenarioConfiguration',
                   'trials', 'scenarioSummaries', 'modelSummaries',
                   'completion', 'recommendation', 'notes']) {
    assert.ok(k in doc, `results.json missing "${k}"`);
  }
  assert.ok(doc.scenarioSummaries.length > 0,
    'per-scenario detail must survive in the JSON');
  assert.equal(doc.exportMetadata.methodology, 'FULL_EVALUATION_ALL_CANDIDATES');
});

test('U8b. benchmark CSVs are interpretable without the JSON', () => {
  const r = seeded();
  const opts = { sessionId: r.sessionId, requiredRepetitions: 3,
                 startedIso: '2026-09-04T00:00:00.000Z', userAgent: 'test-agent' };
  const trials = buildTrialsCsv(r.getTrials(), opts);
  const tCols = trials.split(String.fromCharCode(10))[0].split(',');
  for (const c of ['benchmark_session_id', 'schema_version', 'protocol_version',
                   'session_started_at', 'exported_at', 'user_agent',
                   'candidate_model_id', 'candidate_model_name', 'model_family',
                   'task', 'scenario_id', 'scenario_type',
                   'expected_target_present', 'detection_result',
                   'max_target_score', 'median_inference_ms', 'delegate',
                   'model_asset_file', 'video_width', 'video_height']) {
    assert.ok(tCols.includes(c), `benchmark trials CSV missing ${c}`);
  }
  assert.ok(trials.includes('test-agent'), 'environment metadata travels in rows');

  const summary = buildModelSummaryCsv(r.getTrials(), opts);
  const sCols = summary.split(String.fromCharCode(10))[0].split(',');
  for (const c of ['benchmark_session_id', 'schema_version', 'protocol_version',
                   'session_started_at', 'user_agent',
                   'candidate_model_id', 'candidate_model_name', 'task',
                   'scenarios_required', 'scenarios_completed',
                   'completion_status', 'recall', 'specificity', 'precision',
                   'discriminability', 'median_inference_ms',
                   'repetitions_required', 'rank', 'recommended_for_task',
                   'suggested_operating_threshold', 'trials_required',
                   'trials_completed']) {
    assert.ok(sCols.includes(c), `benchmark summary CSV missing ${c}`);
  }
});

test('U9. an incomplete candidate is reported INCOMPLETE, never ranked', () => {
  // Official method is full evaluation: a model evaluated on a subset must not
  // receive a rank or a recommendation it has not earned.
  const r = seeded();                       // only 2 of 9 person scenarios
  const rows = buildModelSummaries(r.getTrials(), { requiredRepetitions: 3 });
  const person = rows.find((x) => x.task === 'person');
  assert.equal(person.completenessFlag, 'INCOMPLETE');
  assert.equal(person.finalRank, null, 'no rank without full data');
  assert.match(person.finalRecommendation, /INCOMPLETE/);
  assert.ok(person.scenariosCompleted < person.scenariosRequired);
});

test('U10. a fully evaluated candidate is ranked and recommended', () => {
  const r = new BenchmarkRunner({});
  for (const s of PERSON_SCENARIOS) {
    for (let i = 0; i < 3; i++) {
      r.recordTrial({
        task: 'person', scenarioId: s.id, expected: s.expect, stage: 1,
        observation: obs(s.expect
          ? {}
          : { personDetected: false, personMaxScore: null, topOther: [] }),
      });
    }
  }
  const rows = buildModelSummaries(r.getTrials(), { requiredRepetitions: 3 });
  const person = rows.find((x) => x.task === 'person');
  assert.equal(person.completenessFlag, 'COMPLETE');
  assert.equal(person.scenariosCompleted, PERSON_SCENARIOS.length);
  assert.equal(person.finalRank, 1);
  assert.equal(person.finalRecommendation, 'RECOMMENDED');
});

test('U11. the recommendation refuses to conclude on partial data', () => {
  const rec = buildRecommendation(seeded().getTrials(), { requiredRepetitions: 3 });
  assert.equal(rec.strategy, 'INCOMPLETE');
  assert.equal(rec.presenceModel, null);
  assert.match(rec.rationale, /not finished|Complete all/i);
});

test('U12. staged elimination is gone from the official flow', () => {
  const src = read('../tools/benchmark/exportResults.js');
  for (const banned of ['ADVANCE', 'BORDERLINE', 'quickVerdict']) {
    assert.ok(!new RegExp(`['\"\`]${banned}['\"\`]`).test(src),
      `official export must not emit staged verdict "${banned}"`);
  }
  assert.ok(!MODEL_SUMMARY_COLUMNS.includes('verdict'),
    'model summary reports rank + completion status, not a staged verdict');
  assert.ok(MODEL_SUMMARY_COLUMNS.includes('completion_status'));
  assert.ok(MODEL_SUMMARY_COLUMNS.includes('rank'));
  assert.ok(MODEL_SUMMARY_COLUMNS.includes('recommended_for_task'));
});

test('U13. benchmark_trials.csv has the required columns, one row per trial', () => {
  const r = seeded();
  const csv = buildTrialsCsv(r.getTrials(), { sessionId: r.sessionId });
  const lines = csv.split('\n').filter(Boolean);
  const header = lines[0].split(',');
  assert.deepEqual(header, TRIAL_COLUMNS);
  for (const c of ['benchmark_session_id', 'candidate_model_id',
                   'candidate_model_name', 'task', 'scenario_id',
                   'scenario_group', 'repetition_index',
                   'recording_started_at', 'recording_ended_at', 'duration_ms',
                   'scenario_type', 'expected_target_present',
                   'detection_result', 'max_target_score', 'competing_class',
                   'competing_score', 'false_positive', 'false_negative',
                   'median_inference_ms', 'p95_inference_ms', 'delegate',
                   'model_size_bytes', 'video_width', 'video_height']) {
    assert.ok(header.includes(c), `benchmark trials CSV missing ${c}`);
  }
  assert.equal(lines.length - 1, r.getTrials().length);
  for (const line of lines.slice(1)) {
    assert.equal(line.split(',').length, header.length);
  }
});

test('U14. benchmark_scenario_summary.csv aggregates per scenario', () => {
  const r = seeded();
  const csv = buildScenarioSummaryCsv(r.getTrials(), {
    sessionId: r.sessionId, requiredRepetitions: 3,
  });
  const lines = csv.split('\n').filter(Boolean);
  assert.deepEqual(lines[0].split(','), SCENARIO_SUMMARY_COLUMNS);
  assert.equal(lines.length - 1, 2, 'two scenarios were exercised');
  assert.ok(csv.includes('COMPLETE'), 'a fully repeated scenario reads COMPLETE');
});

test('U15. model summary confusion counts match the trials exactly', () => {
  const r = new BenchmarkRunner({});
  r.recordTrial({ task: 'person', scenarioId: 'a', expected: true, observation: obs() });
  r.recordTrial({ task: 'person', scenarioId: 'b', expected: true, observation: obs() });
  r.recordTrial({ task: 'person', scenarioId: 'c', expected: true,
    observation: obs({ personDetected: false, personMaxScore: null }) });
  r.recordTrial({ task: 'person', scenarioId: 'empty_frame', expected: false,
    observation: obs({ personDetected: false, personMaxScore: null }) });
  r.recordTrial({ task: 'person', scenarioId: 'empty_frame', expected: false,
    observation: obs() });

  const [row] = buildModelSummaries(r.getTrials(), { requiredRepetitions: 3 });
  assert.equal(row.tp, 2); assert.equal(row.fn, 1);
  assert.equal(row.tn, 1); assert.equal(row.fp, 1);
  assert.ok(Math.abs(row.sensitivity - 2 / 3) < 1e-9);
  assert.ok(Math.abs(row.specificity - 0.5) < 1e-9);
});

test('U16. no image or video content appears in any export artefact', () => {
  const r = seeded();
  const bundle = buildExportBundle({
    trials: r.getTrials(), session: { sessionId: r.sessionId },
  });
  for (const f of bundle.files) {
    for (const banned of ['data:image', 'blob:', 'ImageData', 'base64', 'canvas']) {
      assert.ok(!f.content.includes(banned), `${f.name} must not contain ${banned}`);
    }
  }
});

test('U17. assertNoImagery rejects binary and image-shaped payloads', () => {
  assert.throws(() => assertNoImagery({ frame: new Uint8Array(4) }), /forbidden key|binary/);
  assert.throws(() => assertNoImagery({ meta: { dataUrl: 'x' } }), /forbidden key/);
  assert.throws(() => assertNoImagery({ note: 'data:image/png;base64,AAA' }), /embedded image/);
  assert.ok(assertNoImagery({ scores: [0.1, 0.2], label: 'person' }));
});

test('U18. a deleted benchmark trial leaves ZERO trace', () => {
  const r = seeded();
  const victim = r.lastTrial();
  r.deleteLastTrial();
  assert.ok(!r.getTrials().some((t) => t.trialId === victim.trialId));
  assert.equal(r.discarded, undefined, 'no tombstone is kept');

  const bundle = buildExportBundle({
    trials: r.getTrials(), session: { sessionId: r.sessionId },
  });
  for (const f of bundle.files) {
    assert.ok(!f.content.includes(victim.trialId), `${f.name} kept a deleted trial`);
  }
  // It also contributes nothing to metrics.
  const rows = buildModelSummaries(r.getTrials(), { requiredRepetitions: 3 });
  assert.equal(rows[0].totalValidTrials, 5);
});

test('U19. export does not mutate the recorded trials', () => {
  const r = seeded();
  const before = JSON.stringify(r.getTrials());
  buildExportBundle({ trials: r.getTrials(), session: { sessionId: r.sessionId } });
  buildModelSummaryCsv(r.getTrials(), {});
  buildScenarioSummaryCsv(r.getTrials(), {});
  assert.equal(JSON.stringify(r.getTrials()), before,
    'a report must never alter its own inputs');
});

test('U19b. benchmark completion counts every required candidate x task', () => {
  const c = benchmarkCompletion(seeded().getTrials(), { requiredRepetitions: 3 });
  assert.ok(c.scenariosTotal > 0);
  assert.equal(c.complete, false, 'a partial run is not complete');
  assert.ok(c.perCandidate.length >= 4, 'every candidate/task pair is tracked');
  assert.ok(c.perCandidate.every((p) => 'scenariosRequired' in p && 'trialsRequired' in p));
});

test('U20. benchmark help documents the FULL-EVALUATION method', () => {
  const ids = BENCH_HELP.map((x) => x.id);
  for (const req of ['purpose', 'recording', 'flow', 'trials', 'reading', 'privacy']) {
    assert.ok(ids.includes(req), `benchmark help missing section ${req}`);
  }
  const all = BENCH_HELP.map((x) => x.html).join(' ');
  assert.match(all, /every candidate is evaluated on every assigned scenario/i,
    'the official method must be stated');
  assert.match(all, /no early elimination|no staged screening/i);
  assert.match(all, /INCOMPLETE/, 'incomplete candidates must be explained');
  assert.match(all, /negative control/i);
  assert.match(all, /not comparable between model families/i,
    'the calibration caveat must be stated');
  // Any precheck must be explicitly demoted.
  const precheck = BENCH_HELP.find((x) => x.id === 'precheck');
  if (precheck) {
    assert.match(precheck.html, /not part of the official evaluation/i);
  }
});

test('U21. debug help explains the page and every developer tab', () => {
  // Titles count too: a section named for a panel is how a reader finds it.
  const all = DEBUG_HELP.map((x) => x.title + ' ' + x.html).join(' ');
  // Current tab names: Signal Inspector / Runtime / Perception.
  for (const term of ['Signal Inspector', 'Runtime', 'PENDING BAKE-OFF',
                      'Head Tilt', 'FOKUS', 'TERALIH', 'TIDAK_HADIR']) {
    assert.ok(all.includes(term), `debug help missing "${term}"`);
  }
  assert.match(all, /PENDING BAKE-OFF/, 'pending perception must be explained');
  assert.match(all, /Repetition 1 of 3|three times/i);
  assert.match(all, /No image, frame or video is ever stored/i);
});

test('U21b. both help sets explain camera vs recording identically', () => {
  for (const [name, sections] of [['debug', DEBUG_HELP], ['bench', BENCH_HELP]]) {
    const rec = sections.find((x) => x.id === 'recording');
    assert.ok(rec, `${name} help needs a recording section`);
    assert.match(rec.html, /RECORDING/);
    assert.match(rec.html, /Countdown/i);
    // The section must state that non-trial frames are not kept, however it
    // words it.
    assert.match(rec.html, /never saved|not recorded|nothing is stored/i,
      `${name} help must say live frames are not kept`);
  }
});

test('U22. every scenario label has an instruction and expected behaviour', () => {
  for (const label of Object.values(ScenarioTruth)) {
    const g = SCENARIO_GUIDE[label];
    assert.ok(g, `no guide entry for ${label}`);
    assert.ok(g.instruction && g.instruction.length > 10, `${label} needs an instruction`);
    assert.ok(g.expected && g.expected.length > 10, `${label} needs expected behaviour`);
  }
});

test('U23. the guide never promises a guaranteed AI outcome', () => {
  // Thresholds are provisional; the guide must describe, not guarantee.
  for (const [label, g] of Object.entries(SCENARIO_GUIDE)) {
    if (/TERALIH|TIDAK_HADIR/.test(g.expected) && !/must/i.test(g.expected)) {
      assert.match(g.expected, /may|should|can/i,
        `${label} should hedge a predicted state transition`);
    }
  }
});

// ── Page structure ──────────────────────────────────────────────────────
test('U24. both dashboards share the header pattern and are scroll-controlled', () => {
  for (const page of ['../public/index.html', '../public/benchmark.html']) {
    const html = read(page);
    assert.match(html, /<header/, `${page} needs a sticky header`);
    assert.match(html, /HACHIKO AI/, `${page} must name the app`);
    assert.match(html, /id="btnHelp"/, `${page} needs a Help button`);
    assert.match(html, /no image stored/, `${page} needs the privacy indicator`);
    assert.match(html, /class="dash"/, `${page} should use the dashboard grid`);
    assert.match(html, /grid-template-columns/, `${page} should be column-based`);
  }
});

test('U25. the debug page provides every element it references', () => {
  const html = read('../public/index.html');

  // Elements that must exist for the primary readouts to update.
  const required = [
    'video', 'status', 'face', 'poseValid',
    'earL', 'earR', 'earMean', 'earRel', 'earSm', 'missing',
    'state', 'reason', 'stateDur', 'evYaw', 'evPitchUp', 'evEye',
    'evPitchDown', 'evRoll', 'eyeElig', 'stateValid',
    'fps', 'inference', 'calStatus', 'calDetail', 'calSamples',
    'yawBar', 'pitchUpBar', 'eyeBar', 'pitchDownBar', 'rollBar',
    // Head pose is now split into aligned raw / Δ / smoothed cells rather than
    // one run-on string like "5.8° / 8.3° / 7.8°", which was unreadable.
    'yawRaw', 'yawDelta', 'yawSm',
    'pitchRaw', 'pitchDelta', 'pitchSm',
    'rollRaw', 'rollDelta', 'rollSm',
    // Observed ranges are min/max cells for the same reason.
    // Live session range is data-driven now: rows are rendered only once a
    // real observation exists, so there are no fixed per-signal cells.
    'rangeBody',
    'rtNonFinite', 'rtWrap',
    // Features & Rules — measurement and rule live in the SAME row now.
    'yawRule', 'yawPers', 'yawStat',
    'pitchUpRule', 'pitchPers', 'pitchStat',
    'pitchDownRule', 'pitchDownPers', 'pitchDownStat',
    'rollRule', 'rollPers', 'rollStat',
    'eyeEligCell', 'eyeThresh', 'eyePers', 'eyeStat', 'eyeReason',
  ];
  for (const el of required) {
    assert.ok(html.includes(`id="${el}"`), `debug page lost element #${el}`);
  }

  // Structural guard: every id the script reaches for must exist in the markup.
  const ids = new Set([...html.matchAll(/id="([a-zA-Z0-9]+)"/g)].map((m) => m[1]));
  const refs = new Set([
    ...[...html.matchAll(/id\('([a-zA-Z0-9]+)'\)/g)].map((m) => m[1]),
    ...[...html.matchAll(/set\('([a-zA-Z0-9]+)'/g)].map((m) => m[1]),
  ]);
  const missing = [...refs].filter((r) => !ids.has(r));
  assert.deepEqual(missing, [], `script references missing elements: ${missing}`);
});

test('U26. the benchmark page is model-inspection first', () => {
  const html = read('../public/benchmark.html');
  // LEFT model+input, CENTER live inspector, RIGHT comparison.
  for (const el of ['video', 'overlay', 'models', 'taskPerson', 'taskPhone',
                    'scPerson', 'scPhone', 'pkPerson', 'pkPhone',
                    'topDet', 'vsTargetScore', 'vsCompScore',
                    // Runtime health now has ONE home: Model Overview, placed
                    // above the variable-length detection tables.
                    'ovModel', 'ovCap', 'ovSize', 'ovDelegate',
                    'ovInfer', 'ovFps', 'ovLat', 'ovVideo', 'ovRaw',
                    // Completion detail lives in View Benchmark Progress;
                    // a permanent card duplicated it.
                    'rankBody', 'ranking', 'recBlock',
                    'nextAction', 'toast', 'btnExport', 'btnHelp',
                    'btnStartTrial', 'btnAbort', 'btnInvalid', 'recState',
                    'btnScenario', 'btnProgress', 'scenModal', 'hComplete']) {
    assert.ok(html.includes(`id="${el}"`), `benchmark page missing #${el}`);
  }
  assert.match(html, /buildExportBundle/, 'export must be wired to the bundle');
  // The full matrix must not hold permanent dashboard space.
  assert.ok(!html.includes('id="scenarios"'),
    'the always-open scenario list must be behind Change Scenario');
  assert.match(html, /Model overview/i);
  assert.match(html, /Live target output/i);
  assert.match(html, /Benchmark capture/i);
  assert.ok(!/Live observation/i.test(html), 'renamed to Live model inspector');
  assert.ok(!/Run a trial/i.test(html), 'renamed to Benchmark capture');
  // No wizard-style numbered headings.
  assert.ok(!/>1 · |>2 · |>3 · |>4 · /.test(html),
    'numbered wizard headings must be gone');
});

test('U26b. staged screening is gone from the bake-off UI', () => {
  const html = read('../public/benchmark.html');
  // Stage selection, quick subsets and staged verdicts are no longer the flow.
  for (const gone of ['id="stage1"', 'id="stage2"', 'id="hStage"',
                      'QUICK_PERSON_SCENARIOS', 'quickVerdictByCandidate',
                      'decideStrategy']) {
    assert.ok(!html.includes(gone), `bake-off page still references ${gone}`);
  }
  assert.match(html, /requiredScenarios/,
    'the scenario list must come from the full required set');
});

test('U26c. each page offers exactly ONE export action', () => {
  // The tester should not have to choose between six export buttons or work
  // out which file the analysis needs.
  const debug = read('../public/index.html');
  assert.match(debug, />Export Session</);
  assert.ok(!/>Export CSV</.test(debug), 'the old CSV-only wording is gone');

  const bench = read('../public/benchmark.html');
  assert.match(bench, />Export</, 'the benchmark export action');
  assert.ok(!/>Export CSV</.test(bench), 'the old CSV-only wording is gone');

  for (const page of ['../public/index.html', '../public/benchmark.html']) {
    const html = read(page);
    const buttons = (html.match(/>Export[A-Za-z ]*</g) ?? []);
    assert.equal(buttons.length, 1, `${page} must expose one export button`);
  }
  // One archive, not three separate downloads. The debug page delegates this
  // to DebugHarness; the benchmark page zips inline.
  assert.match(read('../tools/debug/DebugHarness.js'), /buildZip\(bundle\.files\)/);
  assert.match(bench, /buildZip\(bundle\.files\)/);
});

test('U26d. microcopy uses plain wording, not cryptic counters', () => {
  for (const page of ['../public/index.html', '../public/benchmark.html']) {
    const html = read(page);
    assert.match(html, /Repetition \$\{|Repetition \d/,
      `${page} should say "Repetition N of 3"`);
    assert.match(html, /Delete Last Trial/,
      `${page} should say "Delete Last Trial"`);
    assert.ok(!html.includes('Mark invalid'), `${page} still says "Mark invalid"`);
    assert.ok(!html.includes('Discard saved trial'),
      `${page} should use the literal "Delete Last Trial" wording`);
    assert.match(html, /NOT RECORDING/,
      `${page} must state plainly when nothing is being recorded`);
    // The confirm must warn against deleting a valid but surprising result.
    assert.match(html, /immediate procedural mistake/i,
      `${page} must warn what deletion is for`);
  }
});

test('U26e. the debug page keeps presence and phone visibly pending', () => {
  const html = read('../public/index.html');
  assert.match(html, /PENDING BAKE-OFF/);
  assert.match(html, /class="pair"/, 'presence and phone share one row');
  // No repeated N/A spam: one clean pending statement per block.
  const naCount = (html.match(/>N\/A</g) ?? []).length;
  assert.ok(naCount <= 6, `too many N/A placeholders (${naCount})`);
});

test('U27. production AI config is untouched by the UI work', () => {
  assert.equal(CONFIG.objectDetector.scoreThreshold, 0.30);
  assert.equal(CONFIG.objectDetector.minPersonConfidence, 0.40);
  assert.equal(CONFIG.objectDetector.minPhoneConfidence, 0.50);
  assert.equal(CONFIG.state.STRONG_YAW_DELTA_DEG, 25);
  assert.equal(CONFIG.state.EYE_CLOSED_PERSIST_MS, 3000);
  assert.equal(CONFIG.presence.BOTH_MISSING_ENTER_MS, 2000);
  assert.equal(CONFIG.phoneEvents.PHONE_ENTER_MS, 400);
  assert.equal(CONFIG.headPose.invertPitch, true);
});

// ── The preview must equal what the model processes ────────────────────
test('H1. the camera preview is never cropped', () => {
  // MediaPipe consumes the <video> element directly at its native resolution.
  // `object-fit:cover` would crop it, so the operator would judge framing
  // against pixels the model never sees — and on the benchmark page the
  // detection overlay would land in the wrong place.
  for (const file of ['../public/index.html', '../public/benchmark.html']) {
    const html = readFileSync(new URL(file, import.meta.url), 'utf8');
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1]
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const videoRules = css.split('}').filter((r) => /(^|\s)#?video\b/.test(r.split('{')[0]));
    assert.ok(videoRules.length, `${file} must style the video element`);
    for (const rule of videoRules) {
      assert.ok(!/object-fit:\s*cover/.test(rule),
        `${file} crops the preview: ${rule.trim().slice(0, 60)}`);
    }
    assert.ok(css.includes('object-fit:contain'),
      `${file} must letterbox rather than crop`);
    assert.ok(css.includes('aspect-ratio:4/3'),
      `${file} must hold the 4:3 processing ratio`);
  }
});

test('H2. the processed resolution is visible to the operator', () => {
  const { CONFIG } = configModule;
  assert.equal(CONFIG.camera.width, 640);
  assert.equal(CONFIG.camera.height, 480);
  // Both pages surface the LIVE resolution so a mismatch is noticeable.
  for (const file of ['../public/index.html', '../public/benchmark.html']) {
    const html = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(html, /id="camDims"/, `${file} must show the live resolution`);
  }
});

// ── Help must cover what is actually on screen ─────────────────────────
test('H3. debug help documents every panel and state', () => {
  const all = DEBUG_HELP.map((x) => x.title + ' ' + x.html).join(' ');
  for (const term of [
    // Panels
    'Camera', 'Calibration', 'AI Result', 'Evidence', 'Face signal',
    'Verification Trial', 'Signal Inspector', 'Runtime',
    // Concepts a reader cannot guess
    'Head Tilt', 'Pitch interpretation', 'Eligible', 'Persistence',
    'STRONG', 'SUPPORT', 'PENDING BAKE-OFF',
    // States
    'FOKUS', 'TERALIH', 'TIDAK_HADIR',
  ]) {
    assert.ok(all.includes(term), `debug help missing "${term}"`);
  }
});

test('H4. debug help explains every placeholder the UI can render', () => {
  const all = DEBUG_HELP.map((x) => x.html).join(' ');
  // A reader who sees one of these on screen must be able to look it up.
  for (const state of ['Waiting for camera', 'No face', 'Signal invalid',
                       'Requires calibration', 'Collecting', 'Not applicable',
                       'Unavailable']) {
    assert.ok(all.includes(state), `help must explain the "${state}" state`);
  }
  assert.match(all, /only one that means something is wrong/i,
    'Unavailable must be marked as the actionable one');
});

test('H5. benchmark help documents every panel and the method', () => {
  const all = BENCH_HELP.map((x) => x.title + ' ' + x.html).join(' ');
  for (const term of [
    'Model overview', 'Live target output', 'Model output details',
    'Benchmark capture', 'Scenario Results', 'Model Comparison',
    'Coverage', 'Recall', 'Specificity', 'Discriminability',
    'Pose Landmarker', 'negative control', 'PRELIM',
  ]) {
    assert.ok(all.includes(term), `benchmark help missing "${term}"`);
  }
  assert.match(all, /every candidate is evaluated on every assigned scenario/i);
  assert.match(all, /not comparable between model families/i,
    'the cross-family caveat must survive');
});

test('H6. both help sets explain the camera contract', () => {
  for (const [name, sections] of [['debug', DEBUG_HELP], ['bench', BENCH_HELP]]) {
    const cam = sections.find((x) => x.id === 'camera');
    assert.ok(cam, `${name} help needs a camera section`);
    assert.match(cam.html, /640×480/, 'the processing resolution must be stated');
    assert.match(cam.html, /uncropped|not cropped/i);
    // Mirroring confuses everyone the first time; it must be addressed.
    assert.match(cam.html, /unflipped frame/i,
      'the mirror-vs-inference distinction must be explained');
  }
});

test('H7. help sections are focused, not walls of text', () => {
  for (const [name, sections] of [['debug', DEBUG_HELP], ['bench', BENCH_HELP]]) {
    assert.ok(sections.length >= 6 && sections.length <= 12,
      `${name} help should be 6-12 sections, has ${sections.length}`);
    for (const sec of sections) {
      assert.ok(sec.id && sec.title, 'every section needs an id and title');
      assert.ok(sec.title.length <= 28,
        `"${sec.title}" is too long for a tab`);
      // Long enough to be useful, short enough to read.
      assert.ok(sec.html.length > 120, `${sec.id} is too thin to help`);
      assert.ok(sec.html.length < 3000,
        `${sec.id} is ${sec.html.length} chars — split it`);
    }
  }
});

test('H8. the delete warning appears in both help sets', () => {
  for (const [name, sections] of [['debug', DEBUG_HELP], ['bench', BENCH_HELP]]) {
    const all = sections.map((x) => x.html).join(' ');
    assert.match(all, /procedural mistake/i, `${name} must scope deletion`);
    assert.match(all, /performed poorly\s+or unexpectedly/i,
      `${name} must warn against deleting an unwelcome result`);
  }
});
