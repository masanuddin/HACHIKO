/**
 * HACHIKO v0.3 — Bake-off scoring  (tools/benchmark)
 * ==================================================
 * Pure functions: no DOM, no models, no I/O. The ranking is therefore
 * reproducible and unit-testable, and the decision is auditable rather than a
 * judgement call written up after the fact.
 *
 * EXPERIMENTAL — never imported by production code.
 */

import { DECISION_WEIGHTS } from './candidates.js';

/**
 * @typedef {Object} TrialResult
 * @property {string} modelId
 * @property {'person'|'phone'|'pose'} task
 * @property {string} scenarioId
 * @property {boolean} expected   whether the target SHOULD be detected
 * @property {boolean} detected
 * @property {number|null} maxScore
 * @property {boolean} falsePositive  target reported when it should not be
 * @property {number} inferenceMs
 */

/** Median of a numeric array. */
export function median(values) {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (clean.length === 0) return null;
  clean.sort((a, b) => a - b);
  const mid = clean.length >> 1;
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

export function percentile(values, p) {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (clean.length === 0) return null;
  clean.sort((a, b) => a - b);
  const idx = Math.min(clean.length - 1, Math.max(0, Math.round(p * (clean.length - 1))));
  return clean[idx];
}

/**
 * Recall over the trials where the target was genuinely present.
 *
 * `criticalIds` are the HACHIKO-specific hard cases (extreme yaw, back-facing,
 * face covered, reading posture, phone at study distance, on desk, partly
 * occluded). Per the bake-off rules these outweigh generic accuracy, so they
 * are weighted double.
 */
export function recall(trials, criticalIds = new Set()) {
  const positives = trials.filter((t) => t.expected);
  if (positives.length === 0) return null;

  let weighted = 0;
  let total = 0;
  for (const t of positives) {
    const w = criticalIds.has(t.scenarioId) ? 2 : 1;
    total += w;
    if (t.detected) weighted += w;
  }
  return total > 0 ? weighted / total : null;
}

/** Count of false positives across negative-control trials. */
export function falsePositiveCount(trials) {
  return trials.filter((t) => !t.expected && (t.detected || t.falsePositive)).length;
}

/**
 * Mean confidence on true detections.
 *
 * DIAGNOSTIC ONLY. Never compare this across model families and never gate on
 * it — see `separation()` for why.
 */
export function meanTrueScore(trials) {
  const scores = trials
    .filter((t) => t.expected && t.detected && typeof t.maxScore === 'number')
    .map((t) => t.maxScore);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

/**
 * Model-specific SEPARATION between positive and negative-control scores.
 *
 * ── WHY THIS REPLACED THE ABSOLUTE CONFIDENCE GATE ───────────────────────
 * The previous scorer required mean positive confidence >= 0.35 for every
 * candidate. That is invalid: EfficientDet-Lite0/Lite2, SSD MobileNetV2 and
 * Pose Landmarker do not share a calibrated score scale, so 0.35 means
 * different things in each. A model whose positives cluster at 0.20 while its
 * negatives never exceed 0.02 is perfectly usable — you simply set ITS
 * operating threshold at ~0.10 — yet the absolute gate would have failed it,
 * and could equally have passed a model scoring 0.40 on positives and 0.38 on
 * noise, which is useless.
 *
 * What actually matters is whether a MODEL-SPECIFIC threshold exists that
 * separates positives from negatives. That is what we measure here.
 *
 * @param {TrialResult[]} trials
 * @returns {Object} separation statistics, all model-local
 */
export function separation(trials) {
  const positives = trials
    .filter((t) => t.expected && typeof t.maxScore === 'number' && Number.isFinite(t.maxScore))
    .map((t) => t.maxScore);
  // Negative controls: the score the model reported for the target class when
  // the target was genuinely absent. Missing/undetected reads as 0.
  const negatives = trials
    .filter((t) => !t.expected)
    .map((t) => (typeof t.maxScore === 'number' && Number.isFinite(t.maxScore) ? t.maxScore : 0));

  if (positives.length === 0) {
    return {
      positiveCount: 0, negativeCount: negatives.length,
      minPositive: null, medianPositive: null, maxPositive: null,
      maxNegative: negatives.length ? Math.max(...negatives) : null,
      margin: null, separable: null, suggestedThreshold: null,
    };
  }

  const minPositive = Math.min(...positives);
  const maxPositive = Math.max(...positives);
  const medianPositive = median(positives);
  const maxNegative = negatives.length ? Math.max(...negatives) : null;

  // Margin = worst positive minus best negative. A positive margin means a
  // threshold exists between them for THIS model.
  const margin = maxNegative === null ? null : minPositive - maxNegative;

  // A margin must be MEANINGFUL, not merely positive. Positives at 0.42 over
  // negatives at 0.40 are arithmetically "separable" but the gap is noise: any
  // threshold in it would flip on frame-to-frame jitter. Require the gap to be
  // a real fraction of the model's own typical positive score, which keeps the
  // test scale-free rather than smuggling an absolute number back in.
  const MIN_RELATIVE_MARGIN = 0.10;
  const separable = margin === null
    ? null
    : (margin > 0 && medianPositive > 0 && (margin / medianPositive) >= MIN_RELATIVE_MARGIN);

  // Midpoint of the gap: the operating threshold this model would use. Not a
  // production value — evidence that a workable one exists.
  const suggestedThreshold = separable ? (minPositive + maxNegative) / 2 : null;

  return {
    positiveCount: positives.length,
    negativeCount: negatives.length,
    minPositive, medianPositive, maxPositive, maxNegative,
    margin, separable, suggestedThreshold,
  };
}

/**
 * Discriminability score in 0..1, from separation rather than absolute scores.
 *
 * Normalised by the model's own positive range, so it is scale-free and
 * therefore comparable ACROSS model families — which raw confidence is not.
 */
export function discriminability(trials) {
  const sep = separation(trials);
  if (sep.margin === null || sep.medianPositive === null) return null;
  if (sep.medianPositive <= 0) return 0;
  // Margin as a fraction of the model's own typical positive score, clamped.
  const ratio = sep.margin / sep.medianPositive;
  return Math.max(0, Math.min(1, ratio));
}

/** Sensitivity: fraction of genuinely-present cases detected. */
export function sensitivity(trials) {
  const positives = trials.filter((t) => t.expected);
  if (positives.length === 0) return null;
  return positives.filter((t) => t.detected).length / positives.length;
}

/** Specificity: fraction of genuinely-absent cases correctly not detected. */
export function specificity(trials) {
  const negatives = trials.filter((t) => !t.expected);
  if (negatives.length === 0) return null;
  return negatives.filter((t) => !t.detected).length / negatives.length;
}

/** Precision: of everything reported, how much was real. Null if nothing reported. */
export function precision(trials) {
  const tp = trials.filter((t) => t.expected && t.detected).length;
  const fp = trials.filter((t) => !t.expected && t.detected).length;
  return (tp + fp) === 0 ? null : tp / (tp + fp);
}

export function falseNegativeCount(trials) {
  return trials.filter((t) => t.expected && !t.detected).length;
}

/** Full confusion + separation profile for one candidate/task pair. */
export function taskMetrics(trials, criticalIds = new Set()) {
  return {
    trialCount: trials.length,
    recall: recall(trials, criticalIds),      // critical-weighted
    sensitivity: sensitivity(trials),          // unweighted
    specificity: specificity(trials),
    precision: precision(trials),
    falseNegatives: falseNegativeCount(trials),
    falsePositives: falsePositiveCount(trials),
    separation: separation(trials),
    discriminability: discriminability(trials),
    // Diagnostic only — never compared across model families.
    meanTrueScore: meanTrueScore(trials),
    medianInferenceMs: median(trials.map((t) => t.inferenceMs)),
    p95InferenceMs: percentile(trials.map((t) => t.inferenceMs), 0.95),
  };
}

/** Normalise latency to 0..1 where lower is better (30 ms budget reference). */
export function latencyScore(medianMs, budgetMs = 30) {
  if (medianMs === null || !Number.isFinite(medianMs)) return 0;
  if (medianMs <= budgetMs) return 1;
  // Linear decay to 0 at 3x budget.
  return Math.max(0, 1 - (medianMs - budgetMs) / (budgetMs * 2));
}

/** Normalise model size to 0..1 where smaller is better (8 MB reference). */
export function sizeScore(bytes, referenceBytes = 8e6) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  if (bytes <= referenceBytes) return 1;
  return Math.max(0, 1 - (bytes - referenceBytes) / (referenceBytes * 2));
}

/**
 * Score one candidate from its trials plus static properties.
 *
 * @param {Object} input
 * @param {string} input.modelId
 * @param {TrialResult[]} input.trials
 * @param {number} input.sizeBytes
 * @param {number} input.integration    0..1, subjective, justified in the report
 * @param {number} input.maintainability 0..1
 * @param {Set<string>} [input.criticalIds]
 */
export function scoreCandidate(input) {
  const { modelId, trials, sizeBytes, integration, maintainability } = input;
  const criticalIds = input.criticalIds ?? new Set();

  const r = recall(trials, criticalIds);
  const fp = falsePositiveCount(trials);
  const negatives = trials.filter((t) => !t.expected).length;
  const latencies = trials.map((t) => t.inferenceMs);
  const medMs = median(latencies);

  // False-positive score: 1.0 when clean, decaying with each false positive.
  const fpScore = negatives === 0 ? null : Math.max(0, 1 - fp / Math.max(1, negatives));

  // Task performance blends critical-weighted recall with the model's own
  // positive/negative separation. Separation is scale-free (normalised by the
  // model's own median positive), so unlike raw confidence it IS comparable
  // across model families.
  const disc = discriminability(trials);
  const accuracy = disc === null ? (r ?? 0) : 0.75 * (r ?? 0) + 0.25 * disc;

  const components = {
    accuracy,
    falsePositives: fpScore ?? 0,
    latency: latencyScore(medMs),
    size: sizeScore(sizeBytes),
    integration,
    maintainability,
  };

  const total =
    components.accuracy * DECISION_WEIGHTS.accuracy +
    components.falsePositives * DECISION_WEIGHTS.falsePositives +
    components.latency * DECISION_WEIGHTS.latency +
    components.size * DECISION_WEIGHTS.size +
    components.integration * DECISION_WEIGHTS.integration +
    components.maintainability * DECISION_WEIGHTS.maintainability;

  return {
    modelId,
    total,
    components,
    stats: {
      recall: r,
      sensitivity: sensitivity(trials),
      specificity: specificity(trials),
      precision: precision(trials),
      falseNegatives: falseNegativeCount(trials),
      falsePositives: fp,
      negativeTrials: negatives,
      separation: separation(trials),
      discriminability: disc,
      // Diagnostic only. NOT comparable across model families.
      meanTrueScore: meanTrueScore(trials),
      medianInferenceMs: medMs,
      p95InferenceMs: percentile(latencies, 0.95),
      sizeBytes,
      trialCount: trials.length,
    },
  };
}

/** Rank scored candidates, best first. */
export function rank(scored) {
  return [...scored].sort((a, b) => b.total - a.total);
}

/**
 * Apply the bake-off decision rules to a set of scored candidates.
 *
 * Rule 1: if ONE object detector is strong enough for both tasks, prefer
 *         one-model simplicity.
 * Rule 2: if phone detection is adequate but generic person detection is not,
 *         recommend Pose Landmarker for presence + the best detector for phone.
 * Rule 3: never force one-model elegance at the cost of reliability.
 *
 * @param {Object} input
 * @param {Object.<string, Object>} input.personByModel  taskMetrics per model
 * @param {Object.<string, Object>} input.phoneByModel   taskMetrics per model
 * @param {Object|null} [input.posePresence]             taskMetrics for pose
 * @param {number} [input.minRecall=0.85]
 * @param {number} [input.minSpecificity=0.99] negative controls must stay clean
 */
export function decideStrategy(input) {
  const {
    personByModel = {}, phoneByModel = {}, posePresence = null,
    minRecall = 0.85, minSpecificity = 0.99,
  } = input;

  /**
   * Adequacy is judged on TASK BEHAVIOUR, not on absolute confidence.
   *
   * A candidate is adequate when it (a) finds the target reliably, (b) does not
   * fire on negative controls, and (c) separates its own positives from its own
   * negatives so a model-specific operating threshold exists.
   *
   * Deliberately NO absolute score gate: scores are not calibrated across
   * EfficientDet / SSD / Pose, so a shared numeric threshold would compare
   * quantities that do not mean the same thing.
   */
  const adequate = (m) => {
    if (!m || typeof m.recall !== 'number' || m.recall < minRecall) return false;
    // Any false positive on a negative control is disqualifying: a presence
    // signal that fires on an empty frame cannot be trusted with absence.
    if (typeof m.specificity === 'number' && m.specificity < minSpecificity) return false;
    // Separation must exist. `separable === null` means no negative control was
    // run, which we treat as unproven rather than passing.
    const sep = m.separation;
    if (!sep || sep.separable !== true) return false;
    return true;
  };

  // Rule 1 — a single detector that clears BOTH bars.
  const bothCapable = Object.keys(personByModel).filter(
    (id) => adequate(personByModel[id]) && adequate(phoneByModel[id])
  );
  if (bothCapable.length > 0) {
    const best = bothCapable.sort(
      (a, b) => (personByModel[b].recall + phoneByModel[b].recall)
              - (personByModel[a].recall + phoneByModel[a].recall)
    )[0];
    return {
      strategy: 'ONE_MODEL',
      objectModel: best,
      presenceSource: 'OBJECT_DETECTOR_PERSON',
      rationale: `${best} clears both person and phone bars; one model is simpler `
               + 'to run, ship and maintain.',
    };
  }

  // Rule 2 — phone works, person does not. Split.
  // Pose is held to the SAME adequacy bar as any detector — a presence signal
  // that fires on an empty frame is worse than no presence signal at all.
  const phoneCapable = Object.keys(phoneByModel).filter((id) => adequate(phoneByModel[id]));
  const poseAdequate = adequate(posePresence);

  if (phoneCapable.length > 0 && poseAdequate) {
    const bestPhone = phoneCapable.sort(
      (a, b) => phoneByModel[b].recall - phoneByModel[a].recall
    )[0];
    return {
      strategy: 'SPLIT_MODEL',
      objectModel: bestPhone,
      presenceSource: 'POSE_LANDMARKER',
      rationale: 'Generic person detection is not reliable enough for presence, '
               + `but ${bestPhone} handles phone. Pose Landmarker covers presence, `
               + 'including the face-unavailable cases that motivated v0.3.',
    };
  }

  // Nothing clears the bars.
  return {
    strategy: 'INCONCLUSIVE',
    objectModel: null,
    presenceSource: null,
    rationale: 'No candidate met the recall / specificity / separation bars. '
             + 'Do not wire any model into production; re-run the matrix or '
             + 'widen the candidate set.',
  };
}

// ── Stage 1: quick elimination ──────────────────────────────────────────

/**
 * Verdict thresholds for the quick-elimination stage.
 * Deliberately permissive on ADVANCE and strict on false positives.
 */
export const QUICK_CRITERIA = Object.freeze({
  ADVANCE_MIN_RECALL: 0.85,
  BORDERLINE_MIN_RECALL: 0.60,
  /** Any false positive on a negative control blocks a clean ADVANCE. */
  MAX_FALSE_POSITIVES_TO_ADVANCE: 0,
  /** Positives must sit above negatives by this fraction of median positive. */
  ADVANCE_MIN_DISCRIMINABILITY: 0.30,
  BORDERLINE_MIN_DISCRIMINABILITY: 0.10,
});

/**
 * Stage-1 verdict for one candidate/task from a short scenario subset.
 *
 * Judged on BEHAVIOUR — does it find the target, does it stay quiet on the
 * negative control, and do its own positives separate from its own negatives.
 * Absolute score magnitude is reported but never gates the verdict, because
 * these models are not calibrated to a common scale.
 *
 * Deterministic: identical trials always yield an identical verdict.
 *
 * @param {TrialResult[]} trials
 * @param {Set<string>} [criticalIds]
 * @returns {{verdict:'ADVANCE'|'BORDERLINE'|'DROP', reasons:string[], metrics:Object}}
 */
export function quickVerdict(trials, criticalIds = new Set()) {
  const m = taskMetrics(trials, criticalIds);
  const reasons = [];

  if (m.trialCount === 0) {
    return { verdict: 'DROP', reasons: ['no trials recorded'], metrics: m };
  }

  const r = m.recall ?? 0;
  const fp = m.falsePositives;
  const disc = m.discriminability;
  const sep = m.separation;

  // ── Hard blockers ────────────────────────────────────────────────────
  // Firing on a negative control is disqualifying for a presence/phone signal.
  if (fp > QUICK_CRITERIA.MAX_FALSE_POSITIVES_TO_ADVANCE) {
    reasons.push(`${fp} false positive(s) on negative control`);
  }
  // Positives that do not rise above negatives cannot be thresholded at all.
  if (sep.separable === false) {
    reasons.push(
      `positives do not separate from negatives (min positive ${fmt(sep.minPositive)} `
      + `<= max negative ${fmt(sep.maxNegative)})`);
  }
  if (sep.separable === null && sep.negativeCount === 0) {
    reasons.push('no negative control run — separation unproven');
  }

  const blocked = reasons.length > 0;

  // ── Recall ───────────────────────────────────────────────────────────
  if (r < QUICK_CRITERIA.BORDERLINE_MIN_RECALL) {
    reasons.push(`recall ${(r * 100).toFixed(0)}% below borderline floor`);
    return { verdict: 'DROP', reasons, metrics: m };
  }

  const discOk = disc !== null && disc >= QUICK_CRITERIA.ADVANCE_MIN_DISCRIMINABILITY;
  const discBorderline = disc !== null && disc >= QUICK_CRITERIA.BORDERLINE_MIN_DISCRIMINABILITY;

  if (!blocked && r >= QUICK_CRITERIA.ADVANCE_MIN_RECALL && discOk) {
    reasons.push(
      `recall ${(r * 100).toFixed(0)}%, clean negatives, `
      + `separation margin ${fmt(sep.margin)} (threshold ~${fmt(sep.suggestedThreshold)})`);
    return { verdict: 'ADVANCE', reasons, metrics: m };
  }

  if (r >= QUICK_CRITERIA.BORDERLINE_MIN_RECALL && (discBorderline || disc === null)) {
    if (!blocked) reasons.push(`recall ${(r * 100).toFixed(0)}% with weak separation`);
    return { verdict: 'BORDERLINE', reasons, metrics: m };
  }

  return { verdict: 'DROP', reasons, metrics: m };
}

function fmt(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3) : '—';
}

/**
 * Roll per-task quick verdicts into one verdict per candidate.
 * The worst task verdict wins: a detector useless for phone is not "advancing"
 * just because person worked.
 */
export function quickVerdictByCandidate(trialsByModelTask, criticalIds = new Set()) {
  const order = { DROP: 0, BORDERLINE: 1, ADVANCE: 2 };
  const out = {};
  for (const [key, trials] of Object.entries(trialsByModelTask)) {
    const [modelId, task] = key.split('|');
    const v = quickVerdict(trials, criticalIds);
    const entry = (out[modelId] ??= { modelId, tasks: {}, verdict: 'ADVANCE' });
    entry.tasks[task] = v;
    if (order[v.verdict] < order[entry.verdict]) entry.verdict = v.verdict;
  }
  return out;
}

/** Render a markdown table from trial results, for the report. */
export function toMarkdownTable(trials) {
  const header = '| Model | Task | Scenario | Detected? | Max score | False positive? | Inference ms |';
  const sep = '|---|---|---|---|---|---|---|';
  const rows = trials.map((t) =>
    `| ${t.modelId} | ${t.task} | ${t.scenarioId} | ${t.detected ? 'yes' : 'no'} `
    + `| ${typeof t.maxScore === 'number' ? t.maxScore.toFixed(3) : '—'} `
    + `| ${t.falsePositive ? 'YES' : 'no'} | ${t.inferenceMs.toFixed(1)} |`);
  return [header, sep, ...rows].join('\n');
}

export default {
  scoreCandidate, rank, decideStrategy, quickVerdict, quickVerdictByCandidate,
  taskMetrics, separation, discriminability,
};
