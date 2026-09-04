/**
 * HACHIKO — Benchmark export  (tools/benchmark)
 * =============================================
 * CSV-only export for the OFFICIAL full-evaluation benchmark.
 *
 * ── OFFICIAL METHODOLOGY ─────────────────────────────────────────────────
 * Every candidate is evaluated on EVERY assigned scenario, with repeated
 * trials. There is no staged elimination: a model is never dropped on a
 * subset, and no ADVANCE/BORDERLINE/DROP verdict feeds the recommendation.
 * Ranking and the final recommendation are computed from the complete
 * collected evidence, and a candidate with missing scenarios is reported as
 * INCOMPLETE rather than being given a verdict it has not earned.
 *
 * ── EXPORT SHAPE ─────────────────────────────────────────────────────────
 * One master results.json plus flat CSVs that open directly in a spreadsheet.
 * A DELETED trial leaves zero trace in any of them: deletion pops it from the
 * live array, so there is nothing for an exporter to filter out.
 *
 * Pure functions: no DOM, no download logic, and export never mutates the
 * trials it reports on.
 *
 * PRIVACY: numbers, labels and box geometry only. No imagery, ever.
 */

import {
  CANDIDATES, BENCH_RECORDING_MS, PERSON_SCENARIOS, PHONE_SCENARIOS,
} from './candidates.js';
import { taskMetrics } from './score.js';

export const EXPORT_SCHEMA_VERSION = 'hachiko-benchmark-export-3.0';

/**
 * Identifies the BENCHMARK PROTOCOL (candidate matrix, scenario definitions,
 * trial window) independently of the export format, so runs recorded under
 * different protocols are never pooled by accident.
 */
export const BENCH_PROTOCOL_VERSION = 'hachiko-benchmark-protocol-1.0';

export const TRIAL_COLUMNS = [
  // Provenance, so the file is reanalysable without opening the JSON.
  'benchmark_session_id', 'schema_version', 'protocol_version',
  'session_started_at', 'exported_at', 'user_agent', 'trial_id',
  'candidate_model_id', 'candidate_model_name', 'model_family',
  'task', 'scenario_id', 'scenario_group', 'repetition_index',
  'repetitions_required',
  'recording_started_at', 'recording_ended_at', 'duration_ms',
  'configured_record_sec',
  'scenario_type', 'expected_target_present',
  'detection_result', 'max_target_score',
  'competing_class', 'competing_score', 'raw_detection_count',
  'false_positive', 'false_negative',
  'median_inference_ms', 'p95_inference_ms', 'delegate', 'model_size_bytes',
  'model_asset_file', 'video_width', 'video_height', 'notes',
];

export const SCENARIO_SUMMARY_COLUMNS = [
  'benchmark_session_id', 'candidate_model_id', 'task',
  'scenario_id', 'scenario_group', 'scenario_type', 'expected_target_present',
  'repetitions_required', 'repetitions_completed', 'completion_flag',
  'detection_count', 'detection_rate',
  'mean_confidence', 'min_confidence', 'max_confidence',
  'false_positive_count',
  'median_inference_ms', 'p95_inference_ms',
];

export const MODEL_SUMMARY_COLUMNS = [
  // Enough context to read this file directly as a model-comparison table.
  'benchmark_session_id', 'schema_version', 'protocol_version',
  'session_started_at', 'exported_at', 'user_agent',
  'candidate_model_id', 'candidate_model_name', 'task',
  'scenarios_required', 'scenarios_completed',
  'trials_required', 'trials_completed', 'completion_status',
  'positive_trials', 'negative_trials',
  'tp', 'tn', 'fp', 'fn',
  'recall', 'sensitivity', 'specificity', 'precision',
  'min_positive_score', 'median_positive_score', 'max_positive_score',
  'max_negative_score', 'margin', 'discriminability',
  // Model-LOCAL threshold. Raw confidence is not comparable across families,
  // so each model gets the operating point its own separation implies.
  'suggested_operating_threshold',
  'median_inference_ms', 'p95_inference_ms',
  'model_size_bytes', 'delegate', 'model_asset_file',
  'repetitions_required', 'rank', 'recommended_for_task',
];

const FORBIDDEN = /^(image|frame|imageData|bitmap|canvas|video|dataUrl|blob|pixels|buffer|src)$/i;

/** Guard the privacy invariant at the export boundary. */
export function assertNoImagery(value, path = 'root', depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return true;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw new Error(`export: binary data at ${path}`);
  }
  for (const [k, child] of Object.entries(value)) {
    if (FORBIDDEN.test(k)) throw new Error(`export: forbidden key "${k}" at ${path}`);
    if (typeof child === 'string' && /^data:image|^blob:/i.test(child)) {
      throw new Error(`export: embedded image at ${path}.${k}`);
    }
    assertNoImagery(child, `${path}.${k}`, depth + 1);
  }
  return true;
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, dp = 4) => (finite(v) ? Number(v.toFixed(dp)) : null);

function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (header, rows) => {
  // A row that does not match the header silently shifts every later column,
  // corrupting the dataset invisibly. Fail loudly at build time instead.
  for (const r of rows) {
    if (r.length !== header.length) {
      throw new Error(`CSV arity mismatch: header has ${header.length} columns, `
        + `row has ${r.length}`);
    }
  }
  return [header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
};

function median(values) {
  const clean = values.filter(finite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = clean.length >> 1;
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}
function percentile(values, p) {
  const clean = values.filter(finite).sort((a, b) => a - b);
  if (!clean.length) return null;
  return clean[Math.min(clean.length - 1, Math.max(0, Math.round(p * (clean.length - 1))))];
}

/** Scenarios a candidate/task must cover for its evaluation to be complete. */
export function requiredScenarios(task) {
  if (task === 'phone') return PHONE_SCENARIOS;
  return PERSON_SCENARIOS;   // 'person' and pose 'presence' share the set
}

const scenarioMeta = (task, id) =>
  requiredScenarios(task).find((s) => s.id === id) ?? null;

/** Group trials by `model|task`. */
export function groupTrials(trials) {
  const out = {};
  for (const t of trials) (out[`${t.modelId}|${t.task}`] ??= []).push(t);
  return out;
}

function confusion(trials) {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (const t of trials) {
    const expected = t.expectedTargetPresent ?? t.expected;
    if (expected) { if (t.detected) tp += 1; else fn += 1; }
    else if (t.detected) fp += 1; else tn += 1;
  }
  return { tp, tn, fp, fn };
}

/**
 * Per-candidate/task rollup for the OFFICIAL comparison.
 * `completenessFlag` is the honest gate: no ranking is claimed for a candidate
 * that has not been evaluated on every required scenario.
 */
export function buildModelSummaries(trials, options = {}) {
  const required = options.requiredRepetitions ?? 3;
  const grouped = groupTrials(trials);
  const rows = [];

  for (const [key, list] of Object.entries(grouped)) {
    const [model, task] = key.split('|');
    const candidate = CANDIDATES.find((c) => c.id === model) ?? null;
    const m = taskMetrics(list);
    const c = confusion(list);
    const need = requiredScenarios(task);
    const completed = need.filter(
      (s) => list.filter((t) => t.scenarioId === s.id).length >= required).length;
    const complete = completed === need.length;

    rows.push({
      model, task,
      modelName: candidate?.label ?? model,
      scenariosRequired: need.length,
      scenariosCompleted: completed,
      completenessFlag: complete ? 'COMPLETE' : 'INCOMPLETE',
      totalValidTrials: list.length,
      positiveTrials: list.filter((t) => (t.expectedTargetPresent ?? t.expected)).length,
      negativeTrials: list.filter((t) => !(t.expectedTargetPresent ?? t.expected)).length,
      ...c,
      recall: m.recall,
      sensitivity: m.sensitivity,
      specificity: m.specificity,
      precision: m.precision,
      separation: m.separation,
      discriminability: m.discriminability,
      medianInferenceMs: m.medianInferenceMs,
      p95InferenceMs: m.p95InferenceMs,
      modelSizeBytes: candidate?.sizeBytes ?? null,
      delegate: list[0]?.delegate ?? candidate?.delegate ?? null,
    });
  }

  // Rank only within COMPLETE evaluations, per task. An incomplete candidate
  // gets no rank rather than a flattering or damning position it has not earned.
  const byTask = {};
  for (const r of rows) (byTask[r.task] ??= []).push(r);
  for (const list of Object.values(byTask)) {
    const complete = list.filter((r) => r.completenessFlag === 'COMPLETE');
    complete.sort((a, b) =>
      (b.recall ?? 0) - (a.recall ?? 0)
      || (b.specificity ?? 0) - (a.specificity ?? 0)
      || (b.discriminability ?? 0) - (a.discriminability ?? 0));
    complete.forEach((r, i) => {
      r.finalRank = i + 1;
      r.finalRecommendation = i === 0 ? 'RECOMMENDED' : 'EVALUATED';
    });
    for (const r of list) {
      if (r.completenessFlag !== 'COMPLETE') {
        r.finalRank = null;
        r.finalRecommendation = 'INCOMPLETE — not eligible for ranking';
      }
    }
  }

  rows.sort((a, b) => a.task.localeCompare(b.task)
    || (a.finalRank ?? 99) - (b.finalRank ?? 99)
    || a.model.localeCompare(b.model));
  return rows;
}

/** Per-scenario rollup: which scenarios are done, and how the model behaved. */
export function buildScenarioSummaries(trials, options = {}) {
  const required = options.requiredRepetitions ?? 3;
  const sessionId = options.sessionId ?? '';
  const bucket = {};
  for (const t of trials) {
    (bucket[`${t.modelId}|${t.task}|${t.scenarioId}`] ??= []).push(t);
  }

  return Object.entries(bucket).map(([key, list]) => {
    const [model, task, scenarioId] = key.split('|');
    const meta = scenarioMeta(task, scenarioId);
    const expected = list[0]?.expectedTargetPresent ?? list[0]?.expected ?? null;
    const detections = list.filter((t) => t.detected).length;
    const scores = list.map((t) => t.maxScore).filter(finite);
    const lat = list.map((t) => t.inferenceMs);

    // ── Scenario-level metrics, read the way a tester actually asks ──
    // On a POSITIVE scenario the question is "did it find the target, and how
    // confidently"; on a NEGATIVE control it is "how often did it fire when it
    // should not, and how close did it get". Reporting detection rate on a
    // negative control reads backwards, which is why these are separate.
    const falseDetections = list.filter((t) => !expected && t.detected).length;
    const falseScores = list
      .filter((t) => !expected && t.detected)
      .map((t) => t.maxScore).filter(finite);

    return {
      sessionId, model, task, scenarioId,
      scenarioGroup: expected ? 'positive' : 'negative_control',
      scenarioType: expected ? 'positive' : 'negative_control',
      expectedTargetPresent: expected,
      repetitionsRequired: required,
      repetitionsCompleted: list.length,
      complete: list.length >= required,
      completionFlag: list.length >= required ? 'COMPLETE' : 'INCOMPLETE',

      // POSITIVE scenarios
      detectionCount: detections,
      detectionRate: list.length ? detections / list.length : null,
      // Median of the per-repetition PEAK scores. Each trial's maxScore is
      // already the peak inside its bounded window, so this is a median of
      // peaks, not a peak of medians.
      medianPeakTargetScore: expected ? median(scores) : null,

      // NEGATIVE controls
      falseDetections: expected ? null : falseDetections,
      falsePositiveRate: expected || !list.length ? null : falseDetections / list.length,
      // Highest target score seen while the target was absent — how close the
      // model came to firing, even on repetitions it got right.
      maxFalseTargetScore: expected ? null
        : (scores.length ? Math.max(...scores) : null),
      maxFalseDetectionScore: falseScores.length ? Math.max(...falseScores) : null,

      meanConfidence: scores.length
        ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      minConfidence: scores.length ? Math.min(...scores) : null,
      maxConfidence: scores.length ? Math.max(...scores) : null,
      falsePositiveCount: list.filter((t) => t.falsePositive).length,
      medianInferenceMs: median(lat),
      p95InferenceMs: percentile(lat, 0.95),
      critical: !!meta?.critical,
      scenarioLabel: meta?.label ?? null,
    };
  }).sort((a, b) => a.model.localeCompare(b.model)
    || a.task.localeCompare(b.task) || a.scenarioId.localeCompare(b.scenarioId));
}

/**
 * Per-model strengths and weaknesses, derived from the SAME scenario summaries
 * the tables show. Only complete scenarios are eligible: a scenario with one
 * repetition is not evidence of a weakness.
 *
 * @returns {{strong: Array, weak: Array}} at most three of each
 */
export function scenarioStrengths(trials, model, task, options = {}) {
  const rows = buildScenarioSummaries(trials, options)
    .filter((r) => r.model === model && r.task === task && r.complete);
  // Success means different things by scenario type: finding the target, or
  // correctly staying silent.
  const scored = rows.map((r) => ({
    scenarioId: r.scenarioId,
    scenarioType: r.scenarioType,
    done: r.repetitionsCompleted,
    required: r.repetitionsRequired,
    hits: r.expectedTargetPresent
      ? r.detectionCount
      : r.repetitionsCompleted - (r.falseDetections ?? 0),
    rate: r.expectedTargetPresent
      ? (r.detectionRate ?? 0)
      : 1 - (r.falsePositiveRate ?? 0),
  })).sort((a, b) => b.rate - a.rate || a.scenarioId.localeCompare(b.scenarioId));

  return {
    strong: scored.filter((x) => x.rate >= 1).slice(0, 3),
    weak: scored.filter((x) => x.rate < 1).slice(-3).reverse(),
  };
}

/** benchmark_trials.csv — one row per VALID trial. */
export function buildTrialsCsv(trials, options = {}) {
  const sessionId = options.sessionId ?? '';
  const required = options.requiredRepetitions ?? 3;
  const startedAt = options.startedIso ?? null;
  const exportedAt = new Date().toISOString();
  const userAgent = options.userAgent ?? null;
  const rows = trials.map((t) => {
    const candidate = CANDIDATES.find((c) => c.id === t.modelId) ?? null;
    const expected = t.expectedTargetPresent ?? t.expected;
    return [
      sessionId, EXPORT_SCHEMA_VERSION, BENCH_PROTOCOL_VERSION,
      startedAt, exportedAt, userAgent, t.trialId,
      t.modelId, candidate?.label ?? t.modelId, candidate?.task ?? '',
      t.task, t.scenarioId,
      expected ? 'positive' : 'negative_control', t.repetition, required,
      t.recordingStartedAtIso ?? t.recordedAtIso, t.recordedAtIso,
      round(t.durationMs ?? BENCH_RECORDING_MS, 0),
      round((t.durationMs ?? BENCH_RECORDING_MS) / 1000, 2),
      t.scenarioType ?? (expected ? 'positive' : 'negative_control'), expected,
      t.detected, round(t.maxScore),
      t.competingClass, round(t.competingScore), t.rawDetectionCount,
      t.falsePositive, t.falseNegative ?? (expected && !t.detected),
      round(t.inferenceMs, 2), round(t.p95InferenceMs ?? t.inferenceMs, 2),
      t.delegate, candidate?.sizeBytes ?? null,
      candidate?.file ?? null,
      t.videoWidth, t.videoHeight, t.notes ?? '',
    ];
  });
  return toCsv(TRIAL_COLUMNS, rows);
}

/** benchmark_scenario_summary.csv — candidate x task x scenario. */
export function buildScenarioSummaryCsv(trials, options = {}) {
  const rows = buildScenarioSummaries(trials, options).map((s) => [
    s.sessionId, s.model, s.task, s.scenarioId, s.scenarioGroup, s.scenarioType,
    s.expectedTargetPresent, s.repetitionsRequired, s.repetitionsCompleted,
    s.completionFlag, s.detectionCount, round(s.detectionRate, 3),
    round(s.meanConfidence), round(s.minConfidence), round(s.maxConfidence),
    s.falsePositiveCount, round(s.medianInferenceMs, 2), round(s.p95InferenceMs, 2),
  ]);
  return toCsv(SCENARIO_SUMMARY_COLUMNS, rows);
}

/** benchmark_model_summary.csv — candidate x task, with rank + recommendation. */
export function buildModelSummaryCsv(trials, options = {}) {
  const sessionId = options.sessionId ?? '';
  const startedAt = options.startedIso ?? null;
  const exportedAt = new Date().toISOString();
  const userAgent = options.userAgent ?? null;
  const required = options.requiredRepetitions ?? 3;
  const rows = buildModelSummaries(trials, options).map((r) => [
    sessionId, EXPORT_SCHEMA_VERSION, BENCH_PROTOCOL_VERSION,
    startedAt, exportedAt, userAgent,
    r.model, r.modelName, r.task,
    r.scenariosRequired, r.scenariosCompleted,
    r.scenariosRequired * required, r.totalValidTrials, r.completenessFlag,
    r.positiveTrials, r.negativeTrials,
    r.tp, r.tn, r.fp, r.fn,
    round(r.recall), round(r.sensitivity), round(r.specificity), round(r.precision),
    round(r.separation?.minPositive), round(r.separation?.medianPositive),
    round(r.separation?.maxPositive), round(r.separation?.maxNegative),
    round(r.separation?.margin), round(r.discriminability),
    round(r.separation?.suggestedThreshold),
    round(r.medianInferenceMs, 2), round(r.p95InferenceMs, 2),
    r.modelSizeBytes, r.delegate,
    (CANDIDATES.find((c) => c.id === r.model) ?? {}).file ?? null,
    required,
    r.finalRank, r.finalRecommendation,
  ]);
  return toCsv(MODEL_SUMMARY_COLUMNS, rows);
}

/**
 * Architectural recommendation, computed ONLY from complete evaluations.
 *
 * ONE_MODEL when a single detector is the top-ranked complete candidate for
 * both person and phone; SPLIT_MODEL when presence and phone are best served by
 * different models. Anything less than full data returns INCOMPLETE — the
 * recommendation must come from the whole benchmark, not a subset.
 */
export function buildRecommendation(trials, options = {}) {
  const summaries = buildModelSummaries(trials, options);
  const best = (task) => summaries.find(
    (r) => r.task === task && r.completenessFlag === 'COMPLETE' && r.finalRank === 1) ?? null;

  const person = best('person');
  const phone = best('phone');
  const pose = best('pose');

  if (!phone || (!person && !pose)) {
    return {
      strategy: 'INCOMPLETE',
      presenceModel: null, phoneModel: null,
      rationale: 'Full evaluation is not finished for every required task. '
               + 'Complete all scenarios for all candidates before drawing a '
               + 'recommendation.',
    };
  }

  // Prefer whichever complete candidate scored best on presence.
  const presenceBest = (pose && person)
    ? ((pose.recall ?? 0) > (person.recall ?? 0) ? pose : person)
    : (pose ?? person);

  if (presenceBest && presenceBest.model === phone.model) {
    return {
      strategy: 'ONE_MODEL',
      presenceModel: presenceBest.model, phoneModel: phone.model,
      rationale: `${phone.model} is top-ranked for both presence and phone on the `
               + 'complete evaluation; one model is simpler to ship and maintain.',
    };
  }
  return {
    strategy: 'SPLIT_MODEL',
    presenceModel: presenceBest?.model ?? null, phoneModel: phone.model,
    rationale: `Presence is best served by ${presenceBest?.model}, phone by `
             + `${phone.model}. Reliability outranks single-model elegance.`,
  };
}

/** Overall completion across every candidate x task the benchmark requires. */
export function benchmarkCompletion(trials, options = {}) {
  const required = options.requiredRepetitions ?? 3;
  let done = 0;
  let total = 0;
  const perCandidate = [];

  for (const c of CANDIDATES) {
    const tasks = c.task === 'pose' ? ['pose'] : ['person', 'phone'];
    for (const task of tasks) {
      const need = requiredScenarios(task);
      const list = trials.filter((t) => t.modelId === c.id && t.task === task);
      const completed = need.filter(
        (s) => list.filter((t) => t.scenarioId === s.id).length >= required).length;
      done += completed;
      total += need.length;
      perCandidate.push({
        model: c.id, task,
        scenariosCompleted: completed, scenariosRequired: need.length,
        trials: list.length, trialsRequired: need.length * required,
        complete: completed === need.length,
      });
    }
  }
  return { perCandidate, scenariosDone: done, scenariosTotal: total,
           complete: done === total };
}

/**
 * Master structured session record.
 *
 * Deleted trials leave zero trace: this is built from the live `trials` array,
 * which a deletion has already popped, so there is nothing to filter out.
 */
export function buildResultsJson(trials, options = {}) {
  const session = options.session ?? {};
  const doc = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportMetadata: {
      application: 'HACHIKO AI', page: 'Perception Model Benchmark',
      methodology: 'FULL_EVALUATION_ALL_CANDIDATES',
      exportedAt: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    },
    environment: {
      userAgent: session.userAgent ?? null,
      viewport: session.viewport ?? null,
      videoWidth: session.videoWidth ?? null,
      videoHeight: session.videoHeight ?? null,
    },
    session: {
      sessionId: session.sessionId ?? null,
      startedAt: session.startedIso ?? null,
      exportedAt: new Date().toISOString(),
      requiredRepetitions: options.requiredRepetitions ?? 3,
      totalTrials: trials.length,
      abortedAttempts: session.abortedCount ?? 0,
    },
    configuration: {
      methodology:
        'Every candidate is evaluated on every assigned scenario with three '
        + 'valid repetitions. No staged elimination; no ADVANCE/BORDERLINE/DROP.',
      recordingWindowMs: BENCH_RECORDING_MS,
      scoringNote:
        'Raw confidence is NOT comparable across model families. Ranking uses '
        + 'recall, specificity and model-local separation.',
    },
    candidates: CANDIDATES.map((c) => ({
      id: c.id, label: c.label, task: c.task, modelFile: c.file,
      sourceUrl: c.url, sizeBytes: c.sizeBytes, delegate: c.delegate,
      labelIndices: c.labelIndices ?? null,
    })),
    scenarioConfiguration: {
      person: PERSON_SCENARIOS.map(({ code, id, label, expect, critical }) =>
        ({ code, id, label, expect, critical: !!critical })),
      phone: PHONE_SCENARIOS.map(({ code, id, label, expect, critical }) =>
        ({ code, id, label, expect, critical: !!critical })),
    },
    trials,
    scenarioSummaries: buildScenarioSummaries(trials, options),
    modelSummaries: buildModelSummaries(trials, options),
    completion: benchmarkCompletion(trials, options),
    recommendation: buildRecommendation(trials, options),
    notes: {
      privacy: 'No webcam image, frame or video is recorded or exported.',
      deletion: 'Deleted trials leave zero trace — no tombstone is retained.',
    },
  };
  assertNoImagery(doc);
  return doc;
}

/**
 * Export bundle: master JSON plus the analysis CSVs, timestamped.
 */
export function buildExportBundle(input) {
  const { trials = [], session = {} } = input;
  assertNoImagery({ trials });

  const d = new Date();
  const stamp = `${d.toISOString().slice(0, 10)}_`
    + `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const options = {
    sessionId: session.sessionId ?? '',
    requiredRepetitions: session.requiredRepetitions ?? 3,
    startedIso: session.startedIso ?? null,
    userAgent: session.userAgent ?? null,
  };

  // A BOM keeps Excel from mangling UTF-8 on open; pandas and R ignore it.
  const bom = '﻿';
  return {
    stamp,
    recommendation: buildRecommendation(trials, options),
    completion: benchmarkCompletion(trials, options),
    archiveName: `hachiko_benchmark_results_${stamp}.zip`,
    // Exactly three files. Per-scenario detail is not dropped — it lives in the
    // JSON under `scenarioSummaries`, so a fourth CSV would only fragment the
    // same data across more files for the tester to reassemble.
    files: [
      { name: 'benchmark_results.json', mime: 'application/json',
        content: JSON.stringify(buildResultsJson(trials, { ...options, session }), null, 2) },
      { name: 'benchmark_trials.csv', mime: 'text/csv',
        content: bom + buildTrialsCsv(trials, options) },
      { name: 'benchmark_summary.csv', mime: 'text/csv',
        content: bom + buildModelSummaryCsv(trials, options) },
    ],
  };
}

export default buildExportBundle;
