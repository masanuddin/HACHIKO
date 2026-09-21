/**
 * HACHIKO — Debug session recorder & export  (tools/debug)
 * ========================================================
 * Owns the Debug Harness experiment record: bounded trials, their telemetry,
 * and the three export artefacts.
 *
 * ── EXPERIMENT-BOUNDARY INTEGRITY ────────────────────────────────────────
 * Only samples handed over by a TrialController — i.e. inside
 * [recordingStartedAt, recordingEndedAt] — are stored. Live preview frames
 * never reach this class. That is the difference between a dataset you can
 * publish and one contaminated by footage of the operator getting ready.
 *
 * Debug telemetry is a TIME SERIES per trial, which is why it exports
 * differently from the Bake-off's one-row-per-trial format. The two must not
 * be merged.
 *
 * PRIVACY: numbers only. No frame, crop, or image is ever retained.
 *
 * RECONSTRUCTED 2026-09-17 after an accidental `git checkout` discarded this
 * file's uncommitted work. Rebuilt from the executable specifications in
 * tests/integrity.test.js, tests/trials.test.js and tests/verdict.test.js,
 * plus the surviving interfaces in DebugHarness.js. It is a reconstruction,
 * not a byte-exact restoration.
 */

import { CONFIG } from '../../src/ai/index.js';
import { scenarioConfigSnapshot, getScenario } from './scenarios.js';
import { evaluateDebugTrial } from './evaluateDebugTrial.js';
import { buildDebugReport } from './debugReport.js';

export const DEBUG_SCHEMA_VERSION = 'hachiko-debug-export-2.0';

/**
 * Identifies the SCENARIO PROTOCOL the trials were run under, independently of
 * the export format. Bump it whenever scenario semantics, durations or expected
 * outcomes change, so sessions recorded under different protocols are never
 * pooled by accident.
 */
export const PROTOCOL_VERSION = 'hachiko-debug-protocol-1.0';

/**
 * debug_trials.csv columns — identity, then validity, then what happened.
 *
 * Session metadata, the full config and the calibration baselines live in the
 * JSON master. Repeating them on every row made the table unreadable without
 * making it more informative.
 */
const TRIAL_COLUMNS = [
  // ── Identity ──
  'session_id', 'trial_id',
  'scenario_code', 'scenario_id', 'scenario_name', 'scenario_category',
  'repetition',
  // ── Was this trial judgeable at all? ──
  'calibration_valid_at_start', 'trial_validity',
  'valid_signal_samples', 'total_samples', 'valid_signal_ratio',
  // ── Expectation vs observation ──
  'expected_trigger', 'observed_trigger', 'expected_outcome',
  'observed_outcome', 'trial_verdict', 'failure_reason',
  'final_state', 'primary_reason', 'matches_expectation',
  'trigger_delay_ms',
  // ── Core metrics over the bounded window ──
  'max_abs_yaw_delta_deg', 'max_pitch_up_delta_deg', 'max_pitch_down_delta_deg',
  'max_abs_head_tilt_delta_deg', 'min_relative_ear',
  // ── The window itself ──
  'sample_count', 'median_fps', 'inference_p50_ms',
  'recording_started_at', 'recording_ended_at', 'duration_ms',
];

/**
 * debug_telemetry.csv columns, in the order the pipeline produces them:
 * identity -> validity -> measurement -> evidence -> persistence -> state.
 *
 * A reader can follow one frame down the row and see how a raw angle became a
 * calibrated delta, then evidence, then a public state.
 */
const TELEMETRY_COLUMNS = [
  'session_id', 'trial_id', 'scenario_code', 'repetition', 'elapsed_ms',
  'timestamp_ms',
  // Validity first: it qualifies every measurement that follows.
  'face_detected', 'head_pose_valid', 'eye_eligible', 'eye_ineligible_reason',
  'state_signal_valid',
  // Measurement.
  'yaw_raw_deg', 'yaw_delta_deg', 'yaw_smoothed_deg',
  'pitch_raw_deg', 'pitch_delta_deg', 'pitch_smoothed_deg',
  'head_tilt_raw_deg', 'head_tilt_delta_deg', 'head_tilt_smoothed_deg',
  'ear_left', 'ear_right', 'ear_mean', 'ear_relative', 'ear_smoothed',
  // Evidence derived from those measurements.
  'yaw_instantaneous', 'pitch_up_instantaneous', 'eye_closure_instantaneous',
  'pitch_down_instantaneous', 'head_tilt_instantaneous',
  'yaw_evidence', 'pitch_up_evidence', 'eye_closure_evidence',
  'pitch_down_support', 'head_tilt_support',
  'yaw_persistence_ms', 'pitch_persistence_ms', 'eye_persistence_ms',
  // The state that evidence produced, and the cost of producing it.
  'public_state', 'primary_reason', 'face_inference_ms', 'fps',
];

/** Flatten one AI telemetry frame into the sample we store. Numbers only. */
export function toSample(frame) {
  const m = frame.measurement ?? {};
  const c = frame.calibrated ?? {};
  const t = frame.temporal ?? {};
  const e = frame.evidence ?? {};
  const ev = e.active ?? {};
  const inst = e.instantaneous ?? {};
  const acc = e.accumulated ?? {};
  const d = frame.classification ?? {};
  const p = frame.performance ?? {};
  const v = frame.validity ?? {};

  return {
    timestampMs: frame.timestampMs,
    faceDetected: !!m.facePresent,
    headPoseValid: !!m.poseValid,
    yawRaw: m.yawRaw, yawDelta: c.yawDelta, yawSmoothed: t.yawSmoothed,
    pitchRaw: m.pitchRaw, pitchDelta: c.pitchDelta, pitchSmoothed: t.pitchSmoothed,
    rollRaw: m.rollRaw, rollDelta: c.rollDelta, rollSmoothed: t.rollSmoothed,
    earLeft: m.earLeft, earRight: m.earRight, earMean: m.earMean,
    earRelative: c.earRelative, earSmoothed: t.earSmoothed,
    eyeEligible: e.eyeEligible ?? null,
    eyeIneligibleReason: e.eyeIneligibleReason ?? null,
    yawInstantaneous: !!inst.yawStrong,
    pitchUpInstantaneous: !!inst.pitchUpStrong,
    eyeClosureInstantaneous: !!inst.eyeClosureStrong,
    pitchDownInstantaneous: !!inst.pitchDownSupport,
    rollInstantaneous: !!inst.rollSupport,
    yawEvidence: !!ev.yawStrong,
    pitchUpEvidence: !!ev.pitchUpStrong,
    eyeClosureEvidence: !!ev.eyeClosureStrong,
    pitchDownSupport: !!ev.pitchDownSupport,
    rollSupport: !!ev.rollSupport,
    yawPersistenceMs: acc.yawStrong ?? null,
    pitchPersistenceMs: acc.pitchUpStrong ?? null,
    eyePersistenceMs: acc.eyeClosureStrong ?? null,
    publicState: d.state,
    primaryReason: d.primaryReason ?? d.reason,
    stateSignalValid: v.stateSignalValid ?? null,
    faceInferenceMs: p.faceInferenceMs ?? p.inferenceMs ?? null,
    fps: p.fps ?? null,
  };
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const maxOf = (arr, pick) => {
  const vals = arr.map(pick).filter(finite);
  return vals.length ? Math.max(...vals) : null;
};
const minOf = (arr, pick) => {
  const vals = arr.map(pick).filter(finite);
  return vals.length ? Math.min(...vals) : null;
};

/**
 * Nearest-rank percentile over the finite values only.
 *
 * Absence is not a slow frame: dropping unmeasured entries keeps a p95 latency
 * an honest statement about the frames that were actually timed.
 */
const percentileOf = (values, p) => {
  const clean = values.filter(finite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const idx = Math.min(clean.length - 1,
    Math.max(0, Math.ceil(p * clean.length) - 1));
  return clean[idx];
};

/**
 * Derive a trial summary from its bounded samples.
 * Purely descriptive — it reports what happened, never judges the AI.
 */
/**
 * Absolute value that PRESERVES absence.
 *
 * `Math.abs(null)` is 0, so mapping before filtering turned "never measured"
 * into "measured exactly zero" — a claim the data never supported. A genuine
 * zero still survives as zero; only absence stays absent.
 */
const absOrNull = (v) => (finite(v) ? Math.abs(v) : null);

/** Trial outcomes that are NOT verdicts: they say a verdict was impossible. */
export const TrialValidity = Object.freeze({
  VALID: 'VALID',
  INVALID_SIGNAL: 'INVALID_SIGNAL',
  INVALID_CALIBRATION: 'INVALID_CALIBRATION',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
});

/** Which signal a scenario's claim actually rests on. */
export const SIGNAL_REQUIREMENT = Object.freeze({
  HEAD_POSE: 'HEAD_POSE',
  EYE: 'EYE',
  DROPOUT: 'DROPOUT',
  BEHAVIOURAL: 'BEHAVIOURAL',
});

/**
 * A scenario is only as valid as the signal its claim depends on.
 *
 * Eye closure cannot be proven by a good head pose, and a yaw scenario cannot
 * be proven by an eligible eye. Grading every scenario against one generic
 * "signal valid" flag let unprovable trials pass.
 */
export function signalRequirementFor(scenarioId) {
  switch (scenarioId) {
    case 'YAW_LEFT_SUSTAINED':
    case 'YAW_RIGHT_SUSTAINED':
    case 'BRIEF_YAW_GLANCE':
    case 'PITCH_UP_SUSTAINED':
    case 'PITCH_DOWN_STUDY_LIKE':
    case 'HEAD_TILT':
      return SIGNAL_REQUIREMENT.HEAD_POSE;
    case 'NORMAL_BLINK':
    case 'SUSTAINED_EYE_CLOSURE':
      return SIGNAL_REQUIREMENT.EYE;
    // Dropout and recovery is the measurement, so a period of invalid signal
    // is expected rather than disqualifying.
    case 'FACE_DROPOUT_RECOVERY':
      return SIGNAL_REQUIREMENT.DROPOUT;
    default:
      return SIGNAL_REQUIREMENT.BEHAVIOURAL;
  }
}

/**
 * Minimum share of the window whose required signal must be usable before a
 * verdict is meaningful.
 *
 * Documented rather than hidden: a trial can lose a few frames to landmark
 * dropout and still be worth grading, but one that lost most of them is not
 * evidence of anything.
 */
export const MIN_VALID_SIGNAL_RATIO = 0.5;

/**
 * The dropout scenario gets a lower floor because signal loss IS its subject.
 * Applying the steady-signal floor there would reject the very behaviour the
 * scenario exists to observe.
 */
export const MIN_DROPOUT_VALID_RATIO = 0.2;

/** Was the signal this scenario depends on usable in this sample? */
function requiredSignalUsable(sample, requirement) {
  if (!sample.faceDetected) return false;
  switch (requirement) {
    case SIGNAL_REQUIREMENT.HEAD_POSE:
      return !!sample.headPoseValid && finite(sample.yawDelta);
    case SIGNAL_REQUIREMENT.EYE:
      return sample.eyeEligible === true && finite(sample.earRelative);
    case SIGNAL_REQUIREMENT.DROPOUT:
    case SIGNAL_REQUIREMENT.BEHAVIOURAL:
    default:
      return !!sample.stateSignalValid;
  }
}

/**
 * Evaluate whether this trial produced enough usable signal to be judged.
 *
 * @param {Array} samples bounded window
 * @param {Object|null} scenario
 * @param {Object|null} calibration per-trial snapshot taken at Start Trial
 */
export function evaluateTrialValidity(samples, scenario, calibration) {
  const requirement = signalRequirementFor(scenario?.id);
  const total = samples.length;
  const validCount = samples.filter(
    (x) => requiredSignalUsable(x, requirement)).length;
  const ratio = total ? validCount / total : null;

  const floor = requirement === SIGNAL_REQUIREMENT.DROPOUT
    ? MIN_DROPOUT_VALID_RATIO : MIN_VALID_SIGNAL_RATIO;

  const base = {
    signalRequirement: requirement,
    validSignalSampleCount: validCount,
    totalSampleCount: total,
    validSignalRatio: ratio,
    minValidSignalRatio: floor,
  };

  // Calibration first: every delta in the window was measured against it, so
  // a bad baseline makes the numbers meaningless however clean they look.
  if (calibration && calibration.valid === false) {
    return { ...base, trialValidity: TrialValidity.INVALID_CALIBRATION,
      trialValidityReason: `calibration was ${calibration.status ?? 'invalid'} `
        + 'when this trial started' };
  }
  if (!total) {
    return { ...base, trialValidity: TrialValidity.INSUFFICIENT_DATA,
      trialValidityReason: 'the bounded window contained no samples' };
  }
  if (ratio < floor) {
    return { ...base, trialValidity: TrialValidity.INVALID_SIGNAL,
      trialValidityReason: `the ${requirement} signal was usable in only `
        + `${Math.round(ratio * 100)}% of the window `
        + `(needs ${Math.round(floor * 100)}%)` };
  }
  // NOTE: whether the signal RECOVERED is a verdict question, not a validity
  // one — `evaluateDebugTrial` answers it for D10 and reports "never
  // recovered" there. Validity only asks whether enough signal existed to
  // judge at all, and the two floors already separate a brief gap from a
  // window that was mostly dead.
  return { ...base, trialValidity: TrialValidity.VALID,
    trialValidityReason: null };
}

/**
 * Did this trial yield evidence a verdict can rest on?
 *
 * PASS and FAIL both did. INVALID did not — and an older record with no
 * verdict at all is treated as not evaluable rather than assumed good.
 */
export function isEvaluable(trial) {
  const v = trial?.summary?.trialVerdict ?? null;
  return v === 'PASS' || v === 'FAIL';
}

export function summariseTrial(trial, scenario) {
  const s = trial.samples ?? [];
  const last = s[s.length - 1] ?? null;

  const validity = evaluateTrialValidity(s, scenario, trial.calibrationAtStart);

  // THE verdict. Window-wide and evidence-based: a trial is graded on what the
  // rule under test actually did, not on the public state at the last sample.
  // Nothing in this file, the exporter or the report may re-score it.
  const verdict = evaluateDebugTrial({ scenario, samples: s, validity });

  // Retained for continuity of the exported record: the first sample where the
  // DISPLAY state left FOKUS. Descriptive only — it no longer decides anything,
  // and a trial where this disagrees with the evidence is exactly what this
  // harness exists to surface.
  const stateIdx = s.findIndex((x) => x.publicState && x.publicState !== 'FOKUS');
  const stateChanged = stateIdx >= 0;

  return {
    observedFinalState: last?.publicState ?? null,
    primaryReason: last?.primaryReason ?? null,
    stateSignalValid: last?.stateSignalValid ?? null,
    triggerExpected: !!scenario?.triggerExpected,
    // Strong evidence somewhere in the window — the thing under test.
    triggerOccurred: verdict.observedTrigger,
    triggerDelayMs: verdict.verificationDetails.firstStrongActivationMs,
    publicStateChanged: stateChanged,
    triggerState: stateChanged ? s[stateIdx].publicState : null,
    triggerReason: stateChanged ? s[stateIdx].primaryReason : null,
    // Reductions that PRESERVE absence: see absOrNull.
    maxYawDelta: maxOf(s, (x) => absOrNull(x.yawDelta)),
    maxPitchDelta: maxOf(s, (x) => absOrNull(x.pitchDelta)),
    // Directional: up is STRONG evidence, down is SUPPORT only. A single
    // absolute maximum would conflate two rules with opposite meanings.
    maxPitchUpDelta: maxOf(s, (x) => (x.pitchDelta > 0 ? x.pitchDelta : null)),
    maxPitchDownDelta: maxOf(s, (x) => (x.pitchDelta < 0 ? -x.pitchDelta : null)),
    maxRollDelta: maxOf(s, (x) => absOrNull(x.rollDelta)),
    minEarRelative: minOf(s, (x) => x.earRelative),
    maxEarRelative: maxOf(s, (x) => x.earRelative),
    faceAvailableRatio: s.length
      ? s.filter((x) => x.faceDetected).length / s.length : null,
    medianFps: median(s.map((x) => x.fps)),
    medianFaceInferenceMs: median(s.map((x) => x.faceInferenceMs)),
    p95FaceInferenceMs: percentileOf(s.map((x) => x.faceInferenceMs), 0.95),
    ...validity,
    // Straight from the authoritative evaluator — never recomputed here.
    trialVerdict: verdict.trialVerdict,
    observedOutcome: verdict.observedOutcome,
    failureReason: verdict.failureReason,
    matchesExpectation: verdict.matchesExpectation,
    verificationDetails: verdict.verificationDetails,
  };
}

function median(values) {
  const clean = values.filter(finite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = clean.length >> 1;
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

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
const round = (v, dp = 4) => (finite(v) ? Number(v.toFixed(dp)) : null);

export class DebugSession {
  constructor(config = CONFIG) {
    this.config = config;
    this.sessionId = `debug_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    this.startedIso = new Date().toISOString();
    this.requiredRepetitions = 3;
    /** @type {Array} bounded, VALID trials only */
    this.trials = [];
    /**
     * Attempts aborted mid-countdown/recording. These were never committed as
     * trials, so this is a live counter, not a record of deleted data.
     */
    this.abortedCount = 0;
    this.calibrationSnapshot = null;
  }

  /** Valid repetitions already recorded for a scenario. */
  repetitionCount(scenarioId) {
    return this.attemptCount(scenarioId);
  }

  /** Every saved bounded trial for a scenario, whatever its verdict. */
  attemptCount(scenarioId) {
    return this.trials.filter((t) => t.scenario === scenarioId).length;
  }

  /**
   * Repetitions that actually produced EVIDENCE: PASS or FAIL.
   *
   * An INVALID trial could not be judged — the required signal was unusable,
   * or the operator never performed the challenge — so it proves nothing about
   * the pipeline and must not fill a slot in the official three. It is still
   * saved and still exported; it simply does not count.
   *
   * FAIL counts. A failure is a real result about real behaviour, and retrying
   * until it turns green would be selecting the dataset for its conclusion.
   */
  evaluableCount(scenarioId) {
    return this.trials.filter((t) => t.scenario === scenarioId
      && isEvaluable(t)).length;
  }

  /** Attempts / evaluable / pass / fail / invalid for one scenario. */
  scenarioTally(scenarioId) {
    const mine = this.trials.filter((t) => t.scenario === scenarioId);
    const verdictOf = (t) => t.summary?.trialVerdict ?? null;
    const pass = mine.filter((t) => verdictOf(t) === 'PASS').length;
    const fail = mine.filter((t) => verdictOf(t) === 'FAIL').length;
    return {
      attempts: mine.length,
      evaluable: pass + fail,
      pass,
      fail,
      invalid: mine.length - pass - fail,
    };
  }

  /** Next trial id + repetition, without recording anything. */
  nextTrialRef(scenarioId) {
    const repetition = this.repetitionCount(scenarioId) + 1;
    return { trialId: `${this.sessionId}_${scenarioId}_r${repetition}`, repetition };
  }

  /**
   * Store a completed, bounded trial.
   *
   * @param {Object} trial     the bounded record from TrialController
   * @param {Object} scenario  registry entry it was run under
   * @param {Object|null} calibrationAtStart  DEEP snapshot of the calibration
   *   that was active when Start Trial was pressed. Passed in rather than read
   *   from the session, because a later recalibration must NOT rewrite the
   *   baseline an earlier trial was interpreted against. A trial that recorded
   *   no snapshot keeps null forever — it is never back-filled from whatever
   *   the session happens to hold at export time.
   */
  addTrial(trial, scenario, calibrationAtStart = null) {
    // Real window boundaries. Deriving both ends from one save-time stamp made
    // every trial look instantaneous.
    const endedAt = new Date();
    const duration = finite(trial.recordingDurationMs) ? trial.recordingDurationMs : 0;
    const startedAt = new Date(endedAt.getTime() - duration);

    const cal = calibrationAtStart ? {
      status: calibrationAtStart.status ?? null,
      valid: calibrationAtStart.valid ?? (calibrationAtStart.status === 'VALID'),
      capturedAtIso: calibrationAtStart.capturedAtIso ?? null,
      baseline: calibrationAtStart.baseline
        ? { ...calibrationAtStart.baseline } : null,
    } : null;

    const withCal = { ...trial, calibrationAtStart: cal };
    const record = {
      ...withCal,
      sessionId: this.sessionId,
      group: scenario?.group ?? null,
      // Registry identity travels with the trial, so a row explains itself.
      scenarioCode: scenario?.code ?? null,
      scenarioName: scenario?.name ?? null,
      scenarioCategory: scenario?.category ?? null,
      summary: summariseTrial(withCal, scenario),
      recordingStartedAtIso: startedAt.toISOString(),
      recordingEndedAtIso: endedAt.toISOString(),
      recordedAtIso: endedAt.toISOString(),
    };
    this.trials.push(record);
    return record;
  }

  /**
   * Delete the MOST RECENT saved trial, literally.
   *
   * The trial summary and every linked telemetry sample are removed from
   * memory, so the trial leaves no trace in any CSV, in the JSON, in progress
   * counts, or in summaries. There is deliberately no tombstone, no soft-delete
   * flag and no discarded list: a "deleted" row that still appears somewhere is
   * exactly the dirty-data problem this replaces.
   *
   * Only the last trial can be deleted. Retrospective removal of an arbitrary
   * earlier row would let a tester quietly reshape a finished dataset.
   *
   * @returns {Object|null} the removed trial, or null if there was none
   */
  deleteLastTrial() {
    if (this.trials.length === 0) return null;
    const removed = this.trials.pop();
    // `samples` lived on the trial object, so popping it drops the telemetry
    // with it. Null the reference so nothing can retain it by accident.
    removed.samples = null;
    return removed;
  }

  /** The trial Delete Last Trial would remove, for the confirm dialog. */
  lastTrial() {
    return this.trials.length ? this.trials[this.trials.length - 1] : null;
  }

  /** Every stored trial is valid — invalid ones are removed on the spot. */
  getValidTrials() { return this.trials; }

  /** Per-scenario progress for the scenario list. */
  progress(scenarios) {
    const req = this.requiredRepetitions;
    return scenarios.map((s) => {
      const t = this.scenarioTally(s.id);
      return {
        scenarioId: s.id, group: s.group,
        // `done` is EVALUABLE repetitions: what the official three counts.
        done: Math.min(t.evaluable, req), required: req,
        complete: t.evaluable >= req, pending: !!s.pending,
        // The full picture, so a reader is never shown 3/3 while invalid
        // attempts sit unmentioned.
        attempts: t.attempts, evaluable: t.evaluable,
        pass: t.pass, fail: t.fail, invalid: t.invalid,
      };
    });
  }

  // ── Export ──────────────────────────────────────────────────────────

  /** Config snapshot the trials were interpreted against. */
  configSnapshot() {
    return {
      state: { ...this.config.state },
      temporal: { ...this.config.temporal },
      calibration: { ...this.config.calibration },
      validity: { ...this.config.validity },
      headPose: { ...this.config.headPose },
      eyeEligibility: { ...this.config.eye.eligibility },
    };
  }

  _baseline() {
    return this.calibrationSnapshot?.baseline ?? null;
  }

  /** Environment + calibration facts every standalone file repeats. */
  _context(environment = {}) {
    const b = this._baseline();
    const cal = this.calibrationSnapshot;
    return {
      userAgent: environment.userAgent ?? null,
      viewport: environment.viewport ?? null,
      videoWidth: environment.videoWidth ?? null,
      videoHeight: environment.videoHeight ?? null,
      calStatus: cal?.status ?? 'UNCALIBRATED',
      calSamples: b?.sampleCount ?? null,
      yaw: round(b?.yaw, 2), pitch: round(b?.pitch, 2),
      roll: round(b?.roll, 2), ear: round(b?.ear, 4),
    };
  }

  /**
   * debug_trials.csv — one row per saved trial.
   *
   * An analysis table, not an archive: identity, then whether the trial was
   * judgeable, then what happened. The session metadata, the full config and
   * the calibration baselines live in the JSON master, because repeating them
   * on every row made the table unreadable without making it more informative.
   *
   * Deleted and aborted attempts are absent by construction — they are removed
   * from `this.trials`, so no reader has to filter known-bad rows out again.
   */
  buildTrialsCsv() {
    const rows = this.trials.map((t) => {
      const sm = t.summary ?? {};
      const sc = getScenario(t.scenario) ?? {};
      return [
        this.sessionId, t.trialId,
        t.scenarioCode ?? sc.code ?? null, t.scenario,
        t.scenarioName ?? sc.name ?? null,
        t.scenarioCategory ?? sc.category ?? null,
        t.repetition,
        // Blank, not false, when the trial recorded no snapshot: "unknown" and
        // "known invalid" are different claims.
        t.calibrationAtStart ? !!t.calibrationAtStart.valid : null,
        sm.trialValidity ?? null,
        sm.validSignalSampleCount ?? null, sm.totalSampleCount ?? null,
        round(sm.validSignalRatio, 3),
        sm.triggerExpected, sm.triggerOccurred,
        t.expectedSemanticOutcome ?? null,
        sm.observedOutcome ?? null, sm.trialVerdict ?? null,
        sm.failureReason ?? null,
        sm.observedFinalState ?? null, sm.primaryReason ?? null,
        sm.matchesExpectation,
        round(sm.triggerDelayMs, 0),
        round(sm.maxYawDelta, 2),
        round(sm.maxPitchUpDelta, 2), round(sm.maxPitchDownDelta, 2),
        round(sm.maxRollDelta, 2),
        round(sm.minEarRelative, 4),
        t.sampleCount ?? null,
        round(sm.medianFps, 1), round(sm.medianFaceInferenceMs, 2),
        t.recordingStartedAtIso ?? null, t.recordingEndedAtIso ?? null,
        round(t.recordingDurationMs, 0),
      ];
    });
    return toCsv(TRIAL_COLUMNS, rows);
  }

  /**
   * debug_telemetry.csv — the bounded per-frame time series.
   *
   * Only short identifiers repeat per row. Duplicating the user agent or the
   * full threshold set across tens of thousands of frames would multiply file
   * size for no analytical gain; those live in the JSON, joinable on trial_id.
   */
  buildTelemetryCsv() {
    const rows = [];
    for (const t of this.trials) {
      for (const x of t.samples ?? []) {
        rows.push([
          this.sessionId, t.trialId, t.scenarioCode ?? null, t.repetition,
          round(x.relativeTimeMs, 1), round(x.timestampMs, 1),
          x.faceDetected, x.headPoseValid, x.eyeEligible,
          x.eyeIneligibleReason ?? null, x.stateSignalValid,
          round(x.yawRaw, 2), round(x.yawDelta, 2), round(x.yawSmoothed, 2),
          round(x.pitchRaw, 2), round(x.pitchDelta, 2), round(x.pitchSmoothed, 2),
          round(x.rollRaw, 2), round(x.rollDelta, 2), round(x.rollSmoothed, 2),
          round(x.earLeft), round(x.earRight), round(x.earMean),
          round(x.earRelative), round(x.earSmoothed),
          x.yawInstantaneous, x.pitchUpInstantaneous, x.eyeClosureInstantaneous,
          x.pitchDownInstantaneous, x.rollInstantaneous,
          x.yawEvidence, x.pitchUpEvidence, x.eyeClosureEvidence,
          x.pitchDownSupport, x.rollSupport,
          round(x.yawPersistenceMs, 0), round(x.pitchPersistenceMs, 0),
          round(x.eyePersistenceMs, 0),
          x.publicState, x.primaryReason,
          round(x.faceInferenceMs, 2), round(x.fps, 1),
        ]);
      }
    }
    return toCsv(TELEMETRY_COLUMNS, rows);
  }

  /**
   * debug_results.json — the complete structured record.
   *
   * Standalone by design: it carries the full config, the scenario protocol,
   * per-trial summaries AND the raw samples, so no CSV is needed to reanalyse
   * a session. The CSVs are conveniences for spreadsheet users, not shards of
   * this file.
   */
  buildResultsJson(environment = {}) {
    const b = this._baseline();
    const all = scenarioConfigSnapshot();
    const pending = all.filter((x) => x.pending).length;
    const complete = all.filter(
      (x) => !x.pending && this.repetitionCount(x.id) >= this.requiredRepetitions).length;

    return {
      schemaVersion: DEBUG_SCHEMA_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      pageMode: 'DEBUG',
      session: {
        sessionId: this.sessionId,
        startedAt: this.startedIso,
        exportedAt: new Date().toISOString(),
        requiredRepetitions: this.requiredRepetitions,
        abortedAttempts: this.abortedCount,
      },
      environment: {
        userAgent: environment.userAgent ?? null,
        viewport: environment.viewport ?? null,
        videoWidth: environment.videoWidth ?? null,
        videoHeight: environment.videoHeight ?? null,
      },
      calibration: {
        status: this.calibrationSnapshot?.status ?? 'UNCALIBRATED',
        baseline: b ? { yaw: round(b.yaw, 3), pitch: round(b.pitch, 3),
                        roll: round(b.roll, 3), ear: round(b.ear, 5),
                        sampleCount: b.sampleCount ?? null } : null,
      },
      // The thresholds every measurement in this file must be read against.
      config: this.configSnapshot(),
      // The protocol: which scenarios exist, what each expects.
      scenarios: all,
      progress: {
        totalScenarios: all.length,
        activeScenarios: all.length - pending,
        pendingModelScenarios: pending,
        scenariosComplete: complete,
        scenariosAttempted: new Set(this.trials.map((t) => t.scenario)).size,
        totalValidTrials: this.trials.length,
        perScenario: this.progress(all),
      },
      perception: {
        presenceModel: 'PENDING BAKE-OFF',
        phoneModel: 'PENDING BAKE-OFF',
      },
      // Full record: summaries AND the bounded raw samples.
      trials: this.trials.map((t) => ({
        trialId: t.trialId,
        scenario: t.scenario,
        scenarioCode: t.scenarioCode ?? null,
        scenarioName: t.scenarioName ?? null,
        scenarioCategory: t.scenarioCategory ?? null,
        repetition: t.repetition,
        expectedSemanticOutcome: t.expectedSemanticOutcome,
        // The baseline THIS trial was interpreted against, snapshotted at
        // Start Trial. Null stays null: never back-filled from the session.
        calibrationAtStart: t.calibrationAtStart ?? null,
        recordingStartedAtIso: t.recordingStartedAtIso ?? null,
        recordingEndedAtIso: t.recordingEndedAtIso ?? null,
        recordedAt: t.recordedAtIso,
        recordingDurationMs: t.recordingDurationMs,
        sampleCount: t.sampleCount,
        summary: t.summary,
        // Every bounded observation, unmodified. This is the evidence.
        samples: t.samples ?? [],
      })),
    };
  }

  /**
   * The export: the JSON master plus a human-readable workbook, in one archive.
   *
   * `debug_results.json` is the authoritative evidence — full config, the
   * scenario protocol, per-trial summaries AND the raw bounded samples. The
   * workbook is a PRESENTATION view built from that same document; it is never
   * a second source of truth, and it is not scored independently.
   *
   * One archive because three downloads in a row get blocked by browsers as
   * "multiple downloads", and because it is one decision for the tester.
   */
  buildExportBundle(environment = {}) {
    const d = new Date();
    const stamp = `${d.toISOString().slice(0, 10)}_`
      + `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const doc = this.buildResultsJson(environment);
    return {
      stamp,
      archiveName: `hachiko_debug_session_${stamp}.zip`,
      files: [
        { name: 'debug_results.json', mime: 'application/json',
          content: JSON.stringify(doc, null, 2) },
        { name: 'debug_report.xlsx',
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content: buildDebugReport(doc, d) },
      ],
    };
  }

}

export {
  TRIAL_COLUMNS as DEBUG_TRIAL_COLUMNS,
  TELEMETRY_COLUMNS as DEBUG_TELEMETRY_COLUMNS,
};
export default DebugSession;
