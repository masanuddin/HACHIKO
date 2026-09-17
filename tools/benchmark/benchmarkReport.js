/**
 * HACHIKO — Benchmark XLSX report  (tools/benchmark)
 * ==================================================
 * A PRESENTATION view of the same authoritative objects `benchmark_results.json`
 * is built from. Every metric shown here is read from the summaries the JSON
 * already carries — this file computes no recall, no specificity, no rank, and
 * writes no spreadsheet formula. The only things derived here are presentation
 * counts (how many repetitions of a scenario exist), which are deterministic
 * reductions over the saved trials.
 *
 * Three sheets:
 *   Overview    — phase, progress, model summary, scenario matrices
 *   Trials      — one row per model x scenario x repetition
 *   Raw Samples — bounded observations, for threshold derivation later
 */

import { buildXlsx, S, colName } from '../shared/xlsx.js';
import {
  CANDIDATES, PERSON_SCENARIOS, PHONE_SCENARIOS, BENCH_REQUIRED_REPETITIONS,
} from './candidates.js';

const num = (v, style) =>
  (typeof v === 'number' && Number.isFinite(v) ? { v, s: style } : null);

/** `P01 · Frontal seated` */
function scenarioLabel(task, id) {
  const list = task === 'phone' ? PHONE_SCENARIOS : PERSON_SCENARIOS;
  const sc = list.find((x) => x.id === id);
  return sc ? `${sc.code} · ${sc.label}` : id;
}

/**
 * Readiness wording for a metric the evidence cannot yet support.
 *
 * Distinct from "not applicable": missing evidence means GO COLLECT IT, and
 * rendering it as 0%, 100% or N/A would each assert something false.
 */
const readiness = (value, style, awaitingText) =>
  (typeof value === 'number' && Number.isFinite(value)
    ? { v: value, s: style }
    : { v: awaitingText, s: S.MUTED_WRAP });

/**
 * Short display name for a candidate, for the Overview only.
 *
 * Presentation, not identity: `modelId` stays authoritative in the JSON and in
 * the Trials / Raw Samples sheets. Derived from the registry entry so a new
 * candidate cannot silently lose its label.
 */
function modelShort(modelId) {
  const c = CANDIDATES.find((x) => x.id === modelId);
  if (!c) return modelId;
  if (c.task === 'pose') return 'Pose Lite';
  // `edl0-f16` -> EDL0, `ssd-mnv2-f32` -> SSD.
  return c.id.split('-')[0].toUpperCase();
}

/** `person`/`pose` both answer the presence question; `phone` is its own task. */
const taskLabel = (task) => (task === 'phone' ? 'Phone' : 'Presence');

/**
 * Trials required for one model x task: every scenario in that task's matrix,
 * repeated the canonical number of times. Registry-derived, never a literal —
 * adding a scenario must move this number on its own.
 */
const requiredFor = (task) =>
  (task === 'phone' ? PHONE_SCENARIOS.length : PERSON_SCENARIOS.length)
  * BENCH_REQUIRED_REPETITIONS;

const MODEL_HEADERS = [
  'Model', 'Task', 'Coverage', 'Positive', 'Negative',
  'Recall*', 'Specificity*', 'FPR*', 'Precision*',
  'Median Positive Score', 'Max Negative Score', 'Score Margin',
  'p50 Latency', 'p95 Latency', 'Model Size', 'Status',
];

/** Sheet 1: the command centre. */
function overviewSheet(doc) {
  const trials = doc.trials ?? [];
  const summaries = doc.modelSummaries ?? [];
  const env = doc.environment ?? {};
  const phase = doc.phase
    ?? [...new Set(trials.map((t) => t.phase).filter(Boolean))][0]
    ?? null;
  const isDev = phase !== 'VALIDATION';

  // Required trials across the whole official matrix: object detectors run
  // presence AND phone; the pose challenger runs presence only.
  const objectCount = CANDIDATES.filter((c) => c.task === 'object').length;
  const poseCount = CANDIDATES.filter((c) => c.task === 'pose').length;
  const reps = BENCH_REQUIRED_REPETITIONS;
  const requiredTotal =
    (objectCount + poseCount) * PERSON_SCENARIOS.length * reps
    + objectCount * PHONE_SCENARIOS.length * reps;

  const rows = [
    [{ v: 'HACHIKO PERCEPTION BENCHMARK', s: S.TITLE }],
    [],
    [{ v: 'Phase', s: S.LABEL },
     { v: phase ?? 'No trials yet', s: isDev ? S.WARN : S.VALUE }],
    [{ v: 'Overall Progress', s: S.LABEL },
     { v: `${trials.length} / ${requiredTotal} trials`, s: S.VALUE }],
    [{ v: 'Diagnostic Floor', s: S.LABEL },
     { v: trials[0]?.diagnosticFloor ?? null, s: S.VALUE }],
    [{ v: 'Operating Threshold', s: S.LABEL },
     { v: isDev ? 'NOT FROZEN' : 'FROZEN', s: isDev ? S.WARN : S.VALUE }],
    [{ v: 'Metrics Status', s: S.LABEL },
     { v: isDev ? 'PRELIMINARY' : 'PENDING COVERAGE', s: S.WARN }],
    [{ v: 'Resolution', s: S.LABEL },
     { v: env.videoWidth ? `${env.videoWidth}×${env.videoHeight}` : null, s: S.VALUE }],
    [{ v: 'Delegate', s: S.LABEL }, { v: env.delegate ?? null, s: S.VALUE }],
    [],
    [{ v: 'Development metrics are diagnostic-floor results, not final '
        + 'validation performance.', s: S.MUTED }],
    [],
    [{ v: 'MODEL SUMMARY', s: S.SECTION }],
    MODEL_HEADERS.map((h) => ({ v: h, s: S.HEADER })),
  ];
  // 0-based index of the header row just pushed, and of the summary rows that
  // follow it — both needed so wrapped text is not clipped.
  const modelHeaderRow = rows.length - 1;
  const summaryRowHeights = {};

  for (const r of summaries) {
    const isPose = r.task === 'pose';
    // Coverage, not a bare count: "3" cannot be read without knowing the
    // denominator, and the denominator is what says how much work remains.
    const doneCount = r.totalValidTrials ?? 0;
    const required = requiredFor(r.task);
    rows.push([
      modelShort(r.model), taskLabel(r.task),
      { v: `${doneCount} / ${required}`,
        s: doneCount >= required ? S.PASS : S.DEFAULT },
      r.positiveTrials ?? null, r.negativeTrials ?? null,
      readiness(r.recall, S.PCT1, 'Awaiting positives'),
      readiness(r.specificity, S.PCT1, 'Awaiting negatives'),
      readiness(r.falsePositiveRate, S.PCT1, 'Awaiting negatives'),
      readiness(r.precision, S.PCT1, 'Awaiting + / − data'),
      // Pose reports landmark geometry, not an object confidence — the
      // concept does not apply rather than being unmeasured.
      isPose ? { v: 'N/A', s: S.MUTED_WRAP } : num(r.separation?.medianPositive, S.NUM2),
      isPose ? { v: 'N/A', s: S.MUTED_WRAP } : num(r.separation?.maxNegative, S.NUM2),
      isPose ? { v: 'N/A', s: S.MUTED_WRAP }
             : readiness(r.separation?.margin, S.NUM2, 'Awaiting + / − data'),
      num(r.medianInferenceMs, S.NUM1), num(r.p95InferenceMs, S.NUM1),
      r.modelSizeBytes ? { v: Number((r.modelSizeBytes / 1e6).toFixed(2)), s: S.NUM2 } : null,
      { v: r.completenessFlag ?? null,
        s: r.completenessFlag === 'COMPLETE' ? S.PASS : S.WARN },
    ]);
    summaryRowHeights[rows.length - 1] = 30;
  }
  if (!summaries.length) {
    rows.push([{ v: 'No trials recorded yet.', s: S.MUTED }]);
  }
  rows.push([]);
  rows.push([{ v: '* DEVELOPMENT metrics are preliminary at diagnostic floor.',
    s: S.MUTED }]);
  rows.push([]);

  // ── Progress matrices, derived from saved trials alone ──
  // Nothing here reads a separate progress store, so deleting a trial changes
  // the exported matrix automatically.
  const done = (modelId, task, scenarioId) => trials.filter(
    (t) => t.modelId === modelId && t.task === task && t.scenarioId === scenarioId).length;

  const matrix = (title, scenarios, taskOf, models) => {
    rows.push([{ v: title, s: S.SECTION }]);
    rows.push([{ v: 'Scenario', s: S.HEADER },
      ...models.map((m) => ({ v: m.short, s: S.HEADER }))]);
    for (const sc of scenarios) {
      rows.push([
        `${sc.code} · ${sc.label}`,
        ...models.map((m) => {
          const n = done(m.id, taskOf(m), sc.id);
          const capped = Math.min(n, reps);
          return { v: capped >= reps ? `${capped}/${reps} ✓` : `${capped}/${reps}`,
            s: capped >= reps ? S.PASS : (capped ? S.WARN : S.DEFAULT) };
        }),
      ]);
    }
    rows.push([]);
  };

  const presenceModels = CANDIDATES.map((c) => ({
    id: c.id, short: c.id.split('-')[0].toUpperCase(),
  }));
  matrix('PRESENCE PROGRESS', PERSON_SCENARIOS,
    (m) => (CANDIDATES.find((c) => c.id === m.id)?.task === 'pose' ? 'pose' : 'person'),
    presenceModels);

  const phoneModels = CANDIDATES.filter((c) => c.task === 'object')
    .map((c) => ({ id: c.id, short: c.id.split('-')[0].toUpperCase() }));
  matrix('PHONE PROGRESS', PHONE_SCENARIOS, () => 'phone', phoneModels);

  return {
    name: 'Overview',
    rows,
    // Column A carries scenario labels; F-I and L hold wrapped readiness
    // wording; the rest are numeric and stay narrow so the sheet still fits a
    // normal-zoom screen.
    widths: [30, 11, 11, 10, 10, 14, 14, 14, 14, 16, 15, 14, 11, 11, 11, 14],
    freeze: { row: 1 },
    // Two lines of wrapped readiness text need the height to show both.
    rowHeights: { [modelHeaderRow]: 30, ...summaryRowHeights },
  };
}

const TRIAL_HEADERS = [
  'Phase', 'Model', 'Task', 'Scenario', 'Rep', 'Ground Truth', 'Type',
  'Peak Target Score', 'Detected @ Diagnostic Floor',
  'False Positive*', 'False Negative*',
  'Strongest Competitor', 'Competitor Score',
  'Samples', 'p50 Latency', 'p95 Latency', 'Resolution', 'Delegate',
  'Metric Basis', 'Threshold Status', 'Metrics Status', 'Duration (s)',
];

/** Sheet 2: one row per trial, in logical experimental order. */
function trialsSheet(doc) {
  const rows = [TRIAL_HEADERS.map((h) => ({ v: h, s: S.HEADER }))];

  // Logical order beats chronological for reading; exact timestamps remain in
  // the JSON for anyone reconstructing the session's sequence.
  const order = { person: 0, pose: 1, phone: 2 };
  const sorted = [...(doc.trials ?? [])].sort((a, b) =>
    (order[a.task] ?? 9) - (order[b.task] ?? 9)
    || String(a.scenarioId).localeCompare(String(b.scenarioId))
    || String(a.modelId).localeCompare(String(b.modelId))
    || (a.repetition ?? 0) - (b.repetition ?? 0));

  for (const t of sorted) {
    const expected = t.expectedTargetPresent ?? t.expected;
    const truth = t.task === 'phone'
      ? (expected ? 'PHONE PRESENT' : 'PHONE ABSENT')
      : (expected ? 'PRESENT' : 'ABSENT');
    const fp = t.falsePositiveAtDiagnosticFloor ?? t.falsePositive;
    const fn = t.falseNegativeAtDiagnosticFloor ?? t.falseNegative;
    rows.push([
      t.phase ?? null, t.modelId, t.task,
      scenarioLabel(t.task, t.scenarioId), t.repetition ?? null,
      truth, expected ? 'POSITIVE' : 'NEGATIVE',
      num(t.maxScore, S.NUM2),
      t.detectedAtDiagnosticFloor ?? t.detected ? 'YES' : 'NO',
      // Only one error type is defined per trial: a positive trial cannot
      // produce a false positive, and a negative one cannot produce a false
      // negative. Printing NO in the undefined slot reads as a passed check
      // that was never run. The JSON keeps both booleans untouched.
      expected ? { v: 'N/A', s: S.MUTED }
               : { v: fp ? 'YES' : 'NO', s: fp ? S.FAIL : S.DEFAULT },
      expected ? { v: fn ? 'YES' : 'NO', s: fn ? S.FAIL : S.DEFAULT }
               : { v: 'N/A', s: S.MUTED },
      t.competingClass ?? null, num(t.competingScore, S.NUM2),
      t.sampleCount ?? null,
      num(t.inferenceMs, S.NUM1), num(t.p95InferenceMs, S.NUM1),
      t.videoWidth ? `${t.videoWidth}×${t.videoHeight}` : null, t.delegate ?? null,
      t.metricBasis ?? null,
      { v: t.operatingThresholdStatus ?? null,
        s: t.operatingThresholdStatus === 'NOT_FROZEN' ? S.WARN : S.DEFAULT },
      { v: t.metricsStatus ?? null,
        s: t.metricsStatus === 'PRELIMINARY' ? S.WARN : S.DEFAULT },
      num((t.durationMs ?? 0) / 1000, S.NUM2),
    ]);
  }

  const lastCol = colName(TRIAL_HEADERS.length - 1);
  return {
    name: 'Trials',
    rows,
    widths: [14, 14, 9, 30, 6, 16, 11, 17, 24, 15, 15, 20, 16,
             9, 13, 13, 13, 11, 18, 18, 16, 12],
    freeze: { row: 1, col: 5 },
    autoFilter: `A1:${lastCol}${Math.max(1, rows.length)}`,
    rowHeights: { 0: 30 },
  };
}

const SAMPLE_HEADERS = [
  'Trial', 'Phase', 'Model', 'Task', 'Scenario', 'Rep', 'Elapsed (ms)',
  'Ground Truth', 'Target Score', 'Target Detected @ Floor',
  'Competitor', 'Competitor Score', 'Raw Detections', 'Inference (ms)',
  'Pose Detected', 'Landmark Count', 'Visible Landmarks', 'Presence Score',
];

/** Sheet 3: the evidence threshold derivation will be done against. */
function rawSamplesSheet(doc) {
  const rows = [SAMPLE_HEADERS.map((h) => ({ v: h, s: S.HEADER }))];

  for (const t of doc.trials ?? []) {
    const expected = t.expectedTargetPresent ?? t.expected;
    const truth = t.task === 'phone'
      ? (expected ? 'PHONE PRESENT' : 'PHONE ABSENT')
      : (expected ? 'PRESENT' : 'ABSENT');
    const label = scenarioLabel(t.task, t.scenarioId);
    const isPose = t.task === 'pose';
    const targetOf = (x) => (t.task === 'phone' ? x.phoneMaxScore : x.personMaxScore);
    const detectedOf = (x) => (t.task === 'phone' ? x.phoneDetected : x.personDetected);

    for (const x of t.samples ?? []) {
      rows.push([
        t.trialId, t.phase ?? null, t.modelId, t.task, label,
        t.repetition ?? null, num(x.elapsedMs, S.NUM1), truth,
        // Pose has no object confidence; the cell stays blank rather than
        // borrowing the landmark ratio and calling it a target score.
        isPose ? null : num(targetOf(x), S.NUM2),
        isPose ? null : (detectedOf(x) === null || detectedOf(x) === undefined
          ? null : (detectedOf(x) ? 'YES' : 'NO')),
        isPose ? null : (x.competingClass ?? null),
        isPose ? null : num(x.competingScore, S.NUM2),
        x.rawDetectionCount ?? null, num(x.inferenceMs, S.NUM2),
        // Real pose outputs only, blank for object detectors.
        x.bodyDetected === null || x.bodyDetected === undefined
          ? null : (x.bodyDetected ? 'YES' : 'NO'),
        x.landmarkCount ?? null, x.visibleLandmarks ?? null,
        num(x.presenceScore, S.NUM2),
      ]);
    }
  }

  const lastCol = colName(SAMPLE_HEADERS.length - 1);
  return {
    name: 'Raw Samples',
    rows,
    widths: [34, 14, 14, 9, 30, 6, 13, 16, 13, 23, 18, 16, 15, 14,
             15, 16, 18, 15],
    freeze: { row: 1, col: 7 },
    autoFilter: `A1:${lastCol}${Math.max(1, rows.length)}`,
    rowHeights: { 0: 30 },
  };
}

/**
 * Build benchmark_report.xlsx from the master JSON document.
 * @param {Object} doc  the object `buildResultsJson()` returns
 * @param {Date} [now]
 */
export function buildBenchmarkReport(doc, now = new Date()) {
  return buildXlsx(
    [overviewSheet(doc), trialsSheet(doc), rawSamplesSheet(doc)], now);
}

export default buildBenchmarkReport;
