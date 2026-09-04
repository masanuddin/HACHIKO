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
 */

import { CONFIG } from '../../src/ai/index.js';
import { scenarioConfigSnapshot, getScenario } from './scenarios.js';

export const DEBUG_SCHEMA_VERSION = 'hachiko-debug-export-2.0';

/**
 * Identifies the SCENARIO PROTOCOL the trials were run under, independently of
 * the export format. Bump it whenever scenario semantics, durations or expected
 * outcomes change, so sessions recorded under different protocols are never
 * pooled by accident.
 */
export const PROTOCOL_VERSION = 'hachiko-debug-protocol-1.0';

const TRIAL_COLUMNS = [
  // ── Provenance: which session, which protocol, which config ──
  'session_id', 'page_mode', 'schema_version', 'protocol_version',
  'session_started_at', 'exported_at',
  'trial_id', 'timestamp_start', 'timestamp_end',
  // ── Runtime context (the machine the numbers came off) ──
  'user_agent', 'viewport', 'video_width', 'video_height',
  // ── Calibration context the trial was interpreted against ──
  'calibration_status', 'calibration_samples',
  'baseline_yaw_deg', 'baseline_pitch_deg', 'baseline_roll_deg', 'baseline_ear',
  // ── Scenario identity + instruction, so the row explains itself ──
  'scenario_id', 'scenario_group', 'scenario_label',
  'repetition_index', 'repetitions_required',
  'configured_countdown_sec', 'configured_record_sec', 'actual_record_sec',
  // ── Expectation vs observation ──
  'expected_outcome', 'expected_trigger', 'observed_trigger',
  'final_predicted_state', 'final_primary_reason', 'signal_validity',
  'trigger_delay_sec', 'trigger_state', 'trigger_reason', 'matches_expectation',
  // ── Core metrics over the window ──
  'max_abs_yaw_delta_deg', 'max_pitch_up_delta_deg', 'max_pitch_down_delta_deg',
  'max_abs_head_tilt_delta_deg',
  'min_ear_relative', 'face_available_ratio',
  // ── The thresholds those metrics must be read against ──
  'thr_strong_yaw_deg', 'thr_strong_pitch_up_deg', 'thr_ear_relative',
  'thr_yaw_persist_ms', 'thr_pitch_up_persist_ms', 'thr_eye_persist_ms',
  // ── Runtime performance ──
  'sample_count', 'median_fps', 'median_face_inference_ms',
  'perception_presence_model', 'perception_phone_model',
  'notes',
];

const TELEMETRY_COLUMNS = [
  // Identity repeated per row: a telemetry file must be readable alone. These
  // are short IDs, not the heavy config — that lives in the JSON and, for the
  // values needed to interpret a signal, in the trials CSV.
  'session_id', 'schema_version', 'protocol_version',
  'trial_id', 'scenario_id', 'scenario_group', 'repetition_index',
  'timestamp', 'relative_time_ms',
  'face_detected', 'head_pose_valid',
  'yaw_raw', 'yaw_delta', 'yaw_smoothed',
  'pitch_raw', 'pitch_delta', 'pitch_smoothed',
  'roll_raw', 'roll_delta', 'roll_smoothed',
  'ear_left', 'ear_right', 'ear_mean', 'ear_relative', 'ear_smoothed',
  'eye_eligible', 'eye_ineligible_reason',
  'yaw_evidence', 'pitch_up_evidence', 'eye_closure_evidence',
  'pitch_down_support', 'head_tilt_support',
  'yaw_persistence_ms', 'pitch_persistence_ms', 'eye_persistence_ms',
  'public_state', 'primary_reason', 'state_signal_valid',
  'face_inference_ms', 'fps',
];

/** Flatten one AI telemetry frame into the sample we store. Numbers only. */
export function toSample(frame) {
  const m = frame.measurement ?? {};
  const c = frame.calibrated ?? {};
  const t = frame.temporal ?? {};
  const e = frame.evidence ?? {};
  const ev = e.active ?? {};
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
 * Derive a trial summary from its bounded samples.
 * Purely descriptive — it reports what happened, never judges the AI.
 */
export function summariseTrial(trial, scenario) {
  const s = trial.samples ?? [];
  const last = s[s.length - 1] ?? null;

  // "Trigger" = the first sample where the state left FOKUS inside the window.
  const triggerIdx = s.findIndex((x) => x.publicState && x.publicState !== 'FOKUS');
  const triggerOccurred = triggerIdx >= 0;

  return {
    observedFinalState: last?.publicState ?? null,
    primaryReason: last?.primaryReason ?? null,
    stateSignalValid: last?.stateSignalValid ?? null,
    triggerExpected: !!scenario?.triggerExpected,
    triggerOccurred,
    triggerDelayMs: triggerOccurred ? s[triggerIdx].relativeTimeMs : null,
    triggerState: triggerOccurred ? s[triggerIdx].publicState : null,
    triggerReason: triggerOccurred ? s[triggerIdx].primaryReason : null,
    maxYawDelta: maxOf(s, (x) => Math.abs(x.yawDelta)),
    maxPitchDelta: maxOf(s, (x) => Math.abs(x.pitchDelta)),
    // Directional: up is STRONG evidence, down is SUPPORT only. A single
    // absolute maximum would conflate two rules with opposite meanings.
    maxPitchUpDelta: maxOf(s, (x) => (x.pitchDelta > 0 ? x.pitchDelta : null)),
    maxPitchDownDelta: maxOf(s, (x) => (x.pitchDelta < 0 ? -x.pitchDelta : null)),
    maxRollDelta: maxOf(s, (x) => Math.abs(x.rollDelta)),
    minEarRelative: minOf(s, (x) => x.earRelative),
    faceAvailableRatio: s.length ? s.filter((x) => x.faceDetected).length / s.length : null,
    medianFps: median(s.map((x) => x.fps)),
    medianFaceInferenceMs: median(s.map((x) => x.faceInferenceMs)),
    // Descriptive only. Whether a mismatch means "AI wrong" depends on the
    // ground-truth contract, which a single trial cannot establish.
    matchesExpectation: triggerOccurred === !!scenario?.triggerExpected,
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
    return this.trials.filter((t) => t.scenario === scenarioId).length;
  }

  /** Next trial id + repetition, without recording anything. */
  nextTrialRef(scenarioId) {
    const repetition = this.repetitionCount(scenarioId) + 1;
    return { trialId: `${this.sessionId}_${scenarioId}_r${repetition}`, repetition };
  }

  /** Store a completed, bounded trial. */
  addTrial(trial, scenario) {
    const record = {
      ...trial,
      sessionId: this.sessionId,
      group: scenario?.group ?? null,
      summary: summariseTrial(trial, scenario),
      recordedAtIso: new Date().toISOString(),
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
      const done = this.repetitionCount(s.id);
      return {
        scenarioId: s.id, group: s.group, done: Math.min(done, req), required: req,
        complete: done >= req, pending: !!s.pending,
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
   * debug_trials.csv — one row per VALID saved trial, readable on its own.
   *
   * Session, protocol, calibration, runtime and the thresholds the metrics must
   * be compared against are repeated on every row. That is deliberate
   * redundancy: a tester who opens only this file in Excel can still interpret
   * every number without the JSON beside it.
   *
   * Deleted and aborted attempts are absent by construction — they are removed
   * from `this.trials`, so no reader has to filter known-bad rows out again.
   */
  buildTrialsCsv(environment = {}) {
    const c = this._context(environment);
    const st = this.config.state;
    const tm = this.config.temporal ?? {};
    const exportedAt = new Date().toISOString();
    const rows = this.trials.map((t) => {
      const sm = t.summary ?? {};
      const sc = getScenario(t.scenario) ?? {};
      return [
        this.sessionId, 'DEBUG', DEBUG_SCHEMA_VERSION, PROTOCOL_VERSION,
        this.startedIso, exportedAt,
        t.trialId, t.recordedAtIso, t.endedAtIso ?? t.recordedAtIso,
        c.userAgent, c.viewport, c.videoWidth, c.videoHeight,
        c.calStatus, c.calSamples, c.yaw, c.pitch, c.roll, c.ear,
        t.scenario, t.group, sc.label ?? null,
        t.repetition, this.requiredRepetitions,
        round((sc.countdownMs ?? 0) / 1000, 1),
        round((sc.recordingDurationMs ?? 0) / 1000, 1),
        round((t.recordingDurationMs ?? 0) / 1000, 2),
        t.expectedSemanticOutcome, sm.triggerExpected, sm.triggerOccurred,
        sm.observedFinalState, sm.primaryReason, sm.stateSignalValid,
        round(sm.triggerDelayMs === null || sm.triggerDelayMs === undefined
          ? null : sm.triggerDelayMs / 1000, 2),
        sm.triggerState ?? null, sm.triggerReason ?? null,
        sm.matchesExpectation,
        round(sm.maxYawDelta, 2),
        round(sm.maxPitchUpDelta, 2), round(sm.maxPitchDownDelta, 2),
        round(sm.maxRollDelta, 2),
        round(sm.minEarRelative, 4), round(sm.faceAvailableRatio, 3),
        st.STRONG_YAW_DELTA_DEG, st.STRONG_UP_PITCH_DELTA_DEG,
        st.EAR_RELATIVE_THRESHOLD,
        st.YAW_PERSIST_MS, st.PITCH_UP_PERSIST_MS, st.EYE_CLOSED_PERSIST_MS,
        t.sampleCount, round(sm.medianFps, 1), round(sm.medianFaceInferenceMs, 2),
        'PENDING BAKE-OFF', 'PENDING BAKE-OFF',
        t.notes ?? '',
      ];
    });
    return toCsv(TRIAL_COLUMNS, rows);
  }

  /**
   * debug_telemetry.csv — bounded per-frame time series, readable on its own.
   *
   * Only short identifiers repeat per row. Duplicating the user agent or the
   * full threshold set across tens of thousands of frames would multiply file
   * size for no analytical gain; those live in the trials CSV and the JSON,
   * joinable on `trial_id`.
   */
  buildTelemetryCsv() {
    const rows = [];
    for (const t of this.trials) {
      for (const x of t.samples ?? []) {
        rows.push([
          this.sessionId, DEBUG_SCHEMA_VERSION, PROTOCOL_VERSION,
          t.trialId, t.scenario, t.group, t.repetition,
          round(x.timestampMs, 1), round(x.relativeTimeMs, 1),
          x.faceDetected, x.headPoseValid,
          round(x.yawRaw, 2), round(x.yawDelta, 2), round(x.yawSmoothed, 2),
          round(x.pitchRaw, 2), round(x.pitchDelta, 2), round(x.pitchSmoothed, 2),
          round(x.rollRaw, 2), round(x.rollDelta, 2), round(x.rollSmoothed, 2),
          round(x.earLeft), round(x.earRight), round(x.earMean),
          round(x.earRelative), round(x.earSmoothed),
          x.eyeEligible, x.eyeIneligibleReason ?? null,
          x.yawEvidence, x.pitchUpEvidence, x.eyeClosureEvidence,
          x.pitchDownSupport, x.rollSupport,
          round(x.yawPersistenceMs, 0), round(x.pitchPersistenceMs, 0),
          round(x.eyePersistenceMs, 0),
          x.publicState, x.primaryReason, x.stateSignalValid,
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
        scenarioGroup: t.group,
        scenarioLabel: getScenario(t.scenario)?.label ?? null,
        repetition: t.repetition,
        expectedSemanticOutcome: t.expectedSemanticOutcome,
        recordedAt: t.recordedAtIso,
        recordingDurationMs: t.recordingDurationMs,
        sampleCount: t.sampleCount,
        summary: t.summary,
        samples: t.samples ?? [],
      })),
    };
  }

  /**
   * Exactly three files, each independently interpretable, delivered as one
   * archive. Three downloads in a row get blocked by browsers as "multiple
   * downloads"; one ZIP is also one decision for the tester.
   */
  buildExportBundle(environment = {}) {
    const d = new Date();
    const stamp = `${d.toISOString().slice(0, 10)}_`
      + `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    // A BOM keeps Excel from mangling UTF-8 on open; pandas/R ignore it.
    const bom = '\ufeff';
    return {
      stamp,
      archiveName: `hachiko_debug_session_${stamp}.zip`,
      files: [
        { name: 'debug_results.json', mime: 'application/json',
          content: JSON.stringify(this.buildResultsJson(environment), null, 2) },
        { name: 'debug_trials.csv', mime: 'text/csv',
          content: bom + this.buildTrialsCsv(environment) },
        { name: 'debug_telemetry.csv', mime: 'text/csv',
          content: bom + this.buildTelemetryCsv() },
      ],
    };
  }
}

export {
  TRIAL_COLUMNS as DEBUG_TRIAL_COLUMNS,
  TELEMETRY_COLUMNS as DEBUG_TELEMETRY_COLUMNS,
};
export default DebugSession;
