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
import { BENCH_SCORE_THRESHOLD } from './candidates.js';
import { buildBenchmarkReport } from './benchmarkReport.js';

export const EXPORT_SCHEMA_VERSION = 'hachiko-benchmark-export-3.0';

/**
 * Identifies the BENCHMARK PROTOCOL (candidate matrix, scenario definitions,
 * trial window) independently of the export format, so runs recorded under
 * different protocols are never pooled by accident.
 */
export const BENCH_PROTOCOL_VERSION = 'hachiko-benchmark-protocol-1.0';

/**
 * benchmark_trials.csv — one row per model x task x scenario x repetition.
 *
 * Answers: what was tested, what was true, what the model output, how fast.
 *
 * The legacy aliases (`max_target_score`, `detection_result`, `false_positive`)
 * are gone from the human table: during DEVELOPMENT a "detection" is a score
 * above the diagnostic floor, not an operating-point decision, and a column
 * named `detection_result` invites exactly that misreading. The explicit
 * `*_at_diagnostic_floor` names stay. Legacy fields remain on the trial object
 * and in the JSON for any code that still reads them.
 */
export const TRIAL_COLUMNS = [
  // IDENTITY
  'session_id', 'trial_id', 'phase', 'model', 'task',
  'scenario_code', 'scenario_id', 'scenario_name', 'repetition',
  // GROUND TRUTH
  'ground_truth', 'scenario_type',
  // OBSERVED
  'peak_target_score', 'detected_at_diagnostic_floor',
  'false_positive_at_diagnostic_floor', 'false_negative_at_diagnostic_floor',
  'strongest_competitor', 'strongest_competitor_score',
  // RUNTIME
  'sample_count', 'inference_p50_ms', 'inference_p95_ms',
  'video_width', 'video_height', 'delegate',
  // METRIC PROVENANCE
  'metric_basis', 'diagnostic_floor', 'operating_threshold',
  'operating_threshold_status', 'metrics_status',
  // TIMING
  'recording_started_at', 'recording_ended_at', 'duration_ms',
  'notes',
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

/**
 * benchmark_summary.csv — one row per model x task.
 *
 * Answers: how much evidence exists, what it preliminarily shows, how separated
 * the positive and negative scores are, and what the runtime costs.
 *
 * `sensitivity` is gone: it is the same quantity as `recall`, and exporting a
 * metric twice under two names invites a reader to treat them as independent
 * corroboration. Rank and recommendation are absent too — a DEVELOPMENT table
 * computed at the diagnostic floor has no business carrying a winner column.
 */
export const MODEL_SUMMARY_COLUMNS = [
  // IDENTITY
  'phase', 'model', 'task',
  // COVERAGE
  'scenarios_completed', 'scenarios_required',
  'trials_completed', 'trials_required', 'status',
  // DATA BALANCE
  'positive_trials', 'negative_trials',
  // PERFORMANCE — null wherever the contradicting evidence does not exist yet
  'tp', 'tn', 'fp', 'fn',
  'recall', 'specificity', 'false_positive_rate', 'precision',
  // SCORE BEHAVIOUR
  'min_positive_score', 'median_positive_score', 'max_positive_score',
  'max_negative_score', 'score_margin', 'discriminability',
  'suggested_operating_threshold',
  // RUNTIME / FEASIBILITY
  'inference_p50_ms', 'inference_p95_ms', 'model_size_mb', 'delegate',
  // PROVENANCE
  'metric_basis', 'diagnostic_floor', 'operating_threshold',
  'operating_threshold_status', 'metrics_status',
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
/**
 * Gate a metric on the evidence class that could have contradicted it.
 *
 * Precision computed from positives alone is 1.0 by construction: the model has
 * not yet had a single opportunity to produce a false positive, so reporting
 * "100% precision" states a fact about the sampling, not about the model. The
 * same applies to specificity and false-positive rate without negatives.
 *
 * Unavailable is expressed as null — never 0, 1, or "Not applicable", which
 * would all assert something the data does not support.
 */
export function applyMetricReadiness(metrics, positiveCount, negativeCount) {
  const hasPos = positiveCount > 0;
  const hasNeg = negativeCount > 0;
  const bothClasses = hasPos && hasNeg;
  return {
    ...metrics,
    recall: hasPos ? metrics.recall : null,
    sensitivity: hasPos ? metrics.sensitivity : null,
    specificity: hasNeg ? metrics.specificity : null,
    falsePositiveRate: hasNeg
      ? (negativeCount ? metrics.fp / negativeCount : null) : null,
    // Both classes, or the number describes the sample rather than the model.
    precision: bothClasses ? metrics.precision : null,
    accuracy: bothClasses ? (metrics.accuracy ?? null) : null,
    // Separation needs two distributions to separate.
    discriminability: bothClasses ? metrics.discriminability : null,
    metricReadiness: {
      positiveTrials: positiveCount,
      negativeTrials: negativeCount,
      recallReady: hasPos,
      specificityReady: hasNeg,
      precisionReady: bothClasses,
      separationReady: bothClasses,
    },
  };
}

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

    const positiveTrials = list.filter(
      (t) => (t.expectedTargetPresent ?? t.expected)).length;
    const negativeTrials = list.length - positiveTrials;
    // A metric is reported only when the evidence that could have contradicted
    // it exists. See applyMetricReadiness.
    const ready = applyMetricReadiness({
      recall: m.recall, sensitivity: m.sensitivity,
      specificity: m.specificity, precision: m.precision,
      discriminability: m.discriminability, fp: c.fp,
    }, positiveTrials, negativeTrials);

    rows.push({
      model, task,
      modelName: candidate?.label ?? model,
      scenariosRequired: need.length,
      scenariosCompleted: completed,
      completenessFlag: complete ? 'COMPLETE' : 'INCOMPLETE',
      totalValidTrials: list.length,
      positiveTrials,
      negativeTrials,
      ...c,
      recall: ready.recall,
      sensitivity: ready.sensitivity,
      specificity: ready.specificity,
      precision: ready.precision,
      falsePositiveRate: ready.falsePositiveRate,
      metricReadiness: ready.metricReadiness,
      separation: m.separation,
      discriminability: ready.discriminability,
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
  const rows = trials.map((t) => {
    const candidate = CANDIDATES.find((c) => c.id === t.modelId) ?? null;
    const expected = t.expectedTargetPresent ?? t.expected;
    const meta = scenarioMeta(t.task, t.scenarioId);
    const truth = t.task === 'phone'
      ? (expected ? 'PHONE PRESENT' : 'PHONE ABSENT')
      : (expected ? 'PRESENT' : 'ABSENT');
    return [
      sessionId, t.trialId, t.phase ?? '', t.modelId, t.task,
      meta?.code ?? null, t.scenarioId, meta?.label ?? null, t.repetition,

      truth, expected ? 'POSITIVE' : 'NEGATIVE',

      round(t.maxScore),
      t.detectedAtDiagnosticFloor ?? t.detected,
      t.falsePositiveAtDiagnosticFloor ?? t.falsePositive,
      t.falseNegativeAtDiagnosticFloor ?? t.falseNegative
        ?? (expected && !t.detected),
      t.competingClass, round(t.competingScore),

      t.sampleCount ?? null,
      round(t.inferenceMs, 2), round(t.p95InferenceMs ?? t.inferenceMs, 2),
      t.videoWidth, t.videoHeight, t.delegate,

      t.metricBasis ?? null, t.diagnosticFloor ?? null,
      t.operatingThreshold ?? null, t.operatingThresholdStatus ?? null,
      t.metricsStatus ?? null,

      t.recordingStartedAtIso ?? null, t.recordingEndedAtIso ?? null,
      round(t.durationMs ?? BENCH_RECORDING_MS, 0),
      t.notes ?? '',
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
  const required = options.requiredRepetitions ?? 3;
  const phases = [...new Set(trials.map((t) => t.phase).filter(Boolean))];
  const phase = phases.length === 1 ? phases[0] : (phases.length ? 'MIXED' : null);
  const metricBasis = phase === 'VALIDATION'
    ? 'FROZEN_OPERATING_THRESHOLD' : 'DIAGNOSTIC_FLOOR';
  const operatingStatus = phase === 'VALIDATION' ? 'FROZEN' : 'NOT_FROZEN';
  const metricsStatus = phase === 'VALIDATION' ? 'PENDING_COVERAGE' : 'PRELIMINARY';

  const rows = buildModelSummaries(trials, options).map((r) => [
    phase, r.model, r.task,

    r.scenariosCompleted, r.scenariosRequired,
    r.totalValidTrials, r.scenariosRequired * required, r.completenessFlag,

    r.positiveTrials, r.negativeTrials,

    r.tp, r.tn, r.fp, r.fn,
    round(r.recall), round(r.specificity),
    round(r.falsePositiveRate), round(r.precision),

    round(r.separation?.minPositive), round(r.separation?.medianPositive),
    round(r.separation?.maxPositive), round(r.separation?.maxNegative),
    round(r.separation?.margin), round(r.discriminability),
    round(r.separation?.suggestedThreshold),

    round(r.medianInferenceMs, 2), round(r.p95InferenceMs, 2),
    r.modelSizeBytes ? Number((r.modelSizeBytes / 1e6).toFixed(2)) : null,
    r.delegate,

    metricBasis, BENCH_SCORE_THRESHOLD, null, operatingStatus, metricsStatus,
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
/**
 * Session-level environment, reconciled against what the trials recorded.
 *
 * If a field varied mid-session it is reported as MIXED with the observed
 * values rather than silently claiming one stable environment.
 */
export function deriveEnvironment(trials, session = {}) {
  const agree = (pick) => {
    const vals = [...new Set(trials.map(pick).filter((v) => v !== null && v !== undefined))];
    if (!vals.length) return { value: null, mixed: false, observed: [] };
    if (vals.length === 1) return { value: vals[0], mixed: false, observed: vals };
    return { value: 'MIXED', mixed: true, observed: vals };
  };
  const w = agree((t) => t.videoWidth);
  const h = agree((t) => t.videoHeight);
  const d = agree((t) => t.delegate);
  return {
    userAgent: session.userAgent ?? null,
    viewport: session.viewport ?? null,
    videoWidth: session.videoWidth ?? w.value,
    videoHeight: session.videoHeight ?? h.value,
    delegate: session.delegate ?? d.value,
    environmentStable: !(w.mixed || h.mixed || d.mixed),
    observed: { videoWidth: w.observed, videoHeight: h.observed, delegate: d.observed },
    note: (w.mixed || h.mixed || d.mixed)
      ? 'The environment changed during this session — trial-level values are '
        + 'authoritative.'
      : (w.value === null
        ? 'No trials yet; nothing to derive from.'
        : 'Derived from the recorded trials, which agree.'),
  };
}

export function buildResultsJson(trials, options = {}) {
  const session = options.session ?? {};
  const invalidAttempts = options.invalidAttempts ?? session.invalidAttempts ?? [];
  const attemptSummary = {
    evaluableTrials: trials.length,
    invalidAttempts: invalidAttempts.length,
    totalAttempts: trials.length + invalidAttempts.length,
  };
  const doc = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportMetadata: {
      application: 'HACHIKO AI', page: 'Perception Model Benchmark',
      methodology: 'FULL_EVALUATION_ALL_CANDIDATES',
      exportedAt: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    },
    // Derived from the trials themselves when the session did not supply it,
    // so the master JSON is usable standalone instead of forcing a reader to
    // open the first trial just to learn the input resolution. Nothing is
    // fabricated: a value only appears if the trials actually agree on it.
    // Session phase, surfaced at top level so a reader knows what basis the
    // whole document is on without opening a trial.
    phase: (() => {
      const p = [...new Set(trials.map((t) => t.phase).filter(Boolean))];
      return p.length === 1 ? p[0] : (p.length ? 'MIXED' : null);
    })(),
    environment: deriveEnvironment(trials, session),
    session: {
      sessionId: session.sessionId ?? null,
      startedAt: session.startedIso ?? null,
      exportedAt: new Date().toISOString(),
      requiredRepetitions: options.requiredRepetitions ?? 3,
      totalTrials: trials.length,
      invalidAttempts: invalidAttempts.length,
      totalAttempts: attemptSummary.totalAttempts,
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
    invalidAttempts,
    attemptSummary,
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
  const { trials = [], invalidAttempts = [], session = {} } = input;
  assertNoImagery({ trials, invalidAttempts });

  const d = new Date();
  const stamp = `${d.toISOString().slice(0, 10)}_`
    + `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const options = {
    sessionId: session.sessionId ?? '',
    requiredRepetitions: session.requiredRepetitions ?? 3,
    startedIso: session.startedIso ?? null,
    userAgent: session.userAgent ?? null,
  };

  // ONE document, serialised twice. The workbook reads the summaries the JSON
  // already carries rather than recomputing them, so the two cannot diverge.
  const doc = buildResultsJson(trials, { ...options, session, invalidAttempts });
  const phase = [...new Set(trials.map((t) => t.phase).filter(Boolean))];
  const phaseTag = phase.length === 1 ? `_${phase[0].toLowerCase()}` : '';

  return {
    stamp,
    recommendation: buildRecommendation(trials, options),
    completion: benchmarkCompletion(trials, options),
    archiveName: `hachiko_benchmark${phaseTag}_${stamp}.zip`,
    files: [
      { name: 'benchmark_results.json', mime: 'application/json',
        content: JSON.stringify(doc, null, 2) },
      { name: 'benchmark_report.xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        content: buildBenchmarkReport(doc, d) },
    ],
  };
}

export default buildExportBundle;
