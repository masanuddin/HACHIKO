/**
 * HACHIKO — Debug XLSX report  (tools/debug)
 * ==========================================
 * A PRESENTATION view of the same authoritative objects `debug_results.json`
 * is built from. It formats and orders; it computes no scientific quantity and
 * emits no spreadsheet formula, so a workbook can never disagree with the JSON
 * master beside it in the ZIP.
 *
 * Two sheets, deliberately:
 *   Trial Summary — what was run, was it valid, did it match  (read this one)
 *   Telemetry     — why a particular trial behaved that way   (diagnostics)
 *
 * Session metadata, the full config, calibration baselines and the scenario
 * registry stay in the JSON. The ZIP is the evidence unit; repeating a user
 * agent on every row helps nobody.
 */

import { buildXlsx, S, colName } from '../shared/xlsx.js';
import { getScenario } from './scenarios.js';

/** Blank stays blank. A missing measurement is never rendered as 0. */
const num = (v, style) =>
  (typeof v === 'number' && Number.isFinite(v) ? { v, s: style } : null);

/** `D01 · Neutral frontal` — one readable cell instead of three technical ones. */
function scenarioLabel(trial) {
  const sc = getScenario(trial.scenario) ?? {};
  const code = trial.scenarioCode ?? sc.code;
  const name = trial.scenarioName ?? sc.name ?? trial.scenario;
  return code ? `${code} · ${name}` : name;
}

/** Trigger expectation in words; a bare boolean makes the reader translate. */
const triggerText = (flag, observed) => {
  if (flag === null || flag === undefined) return null;
  if (observed) return flag ? 'Strong trigger activated' : 'No strong trigger';
  return flag ? 'Strong trigger expected' : 'No strong trigger';
};

const TRIAL_HEADERS = [
  'Scenario', 'Rep', 'Validity', 'Valid Signal %',
  'Expected', 'Observed',
  'Match', 'Why It Failed', 'Final State', 'Primary Reason',
  'Yaw Max Δ (°)', 'Pitch Up Max Δ (°)', 'Pitch Down Max Δ (°)',
  'Head Tilt Max Δ (°)', 'EAR Min Rel.', 'Trigger Delay (ms)',
  'Samples', 'FPS Median', 'Inference p50 (ms)', 'Inference p95 (ms)',
  'Duration (s)',
];
const TRIAL_WIDTHS = [
  30, 6, 11, 13, 24, 34, 11, 38, 13, 18,
  13, 15, 16, 16, 12, 15, 9, 11, 16, 16, 12,
];

/** Sheet 1: the everyday page. */
function trialSummarySheet(doc) {
  const trials = doc.trials ?? [];
  const cal = doc.calibration ?? {};

  // Verdict tally, not signal validity. "Valid Trials" used to mean "the
  // signal was usable", which reads as "the verification was valid" — a
  // different and much stronger claim.
  const verdict = (t) => t.summary?.trialVerdict ?? null;
  const pass = trials.filter((t) => verdict(t) === 'PASS').length;
  const fail = trials.filter((t) => verdict(t) === 'FAIL').length;
  const evaluable = pass + fail;
  const invalid = trials.length - evaluable;

  const rows = [
    [{ v: 'HACHIKO DEBUG VERIFICATION REPORT', s: S.TITLE }],
    [],
    [{ v: 'Session ID', s: S.LABEL }, { v: doc.session?.sessionId ?? null, s: S.VALUE }],
    [{ v: 'Export Date', s: S.LABEL }, { v: doc.session?.exportedAt ?? null, s: S.VALUE }],
    [{ v: 'Face Model', s: S.LABEL }, { v: 'MediaPipe Face Landmarker', s: S.VALUE }],
    [{ v: 'Video Resolution', s: S.LABEL },
     { v: doc.environment?.videoWidth
       ? `${doc.environment.videoWidth}×${doc.environment.videoHeight}` : null, s: S.VALUE }],
    [{ v: 'Calibration Status', s: S.LABEL }, { v: cal.status ?? null, s: S.VALUE }],
    [{ v: 'Recorded Attempts', s: S.LABEL }, { v: trials.length, s: S.VALUE }],
    // Evaluable = PASS + FAIL: attempts that actually produced evidence.
    // An INVALID attempt is kept and exported, but proves nothing, so it does
    // not fill one of the three official repetitions.
    [{ v: 'Evaluable Repetitions', s: S.LABEL }, { v: evaluable, s: S.VALUE }],
    [{ v: 'PASS', s: S.LABEL }, { v: pass, s: pass ? S.PASS : S.VALUE }],
    [{ v: 'FAIL', s: S.LABEL }, { v: fail, s: fail ? S.FAIL : S.VALUE }],
    [{ v: 'INVALID', s: S.LABEL }, { v: invalid, s: invalid ? S.WARN : S.VALUE }],
    [],
    TRIAL_HEADERS.map((h) => ({ v: h, s: S.HEADER })),
  ];
  const headerRow = rows.length;          // 1-based row of the table header

  for (const t of trials) {
    const sm = t.summary ?? {};
    const isValid = sm.trialValidity === 'VALID';
    // Three outcomes, three words. Colour only supplements the text.
    const match = !isValid ? { v: 'INVALID', s: S.WARN }
      : sm.matchesExpectation === true ? { v: '✓ PASS', s: S.PASS }
      : sm.matchesExpectation === false ? { v: '✕ FAIL', s: S.FAIL }
      : { v: 'INVALID', s: S.WARN };

    rows.push([
      scenarioLabel(t),
      t.repetition ?? null,
      { v: sm.trialValidity ?? null, s: isValid ? S.DEFAULT : S.WARN },
      num(sm.validSignalRatio, S.PCT1),
      triggerText(sm.triggerExpected, false),
      // Straight from the authoritative evaluator. Re-deriving wording from a
      // boolean here would be a second scoring path, free to disagree with it.
      sm.observedOutcome ?? triggerText(sm.triggerOccurred, true),
      match,
      sm.failureReason ?? null,
      sm.observedFinalState ?? null,
      sm.primaryReason ?? null,
      num(sm.maxYawDelta, S.NUM2),
      num(sm.maxPitchUpDelta, S.NUM2),
      num(sm.maxPitchDownDelta, S.NUM2),
      num(sm.maxRollDelta, S.NUM2),
      num(sm.minEarRelative, S.NUM2),
      num(sm.triggerDelayMs, S.NUM1),
      t.sampleCount ?? null,
      num(sm.medianFps, S.NUM1),
      num(sm.medianFaceInferenceMs, S.NUM2),
      num(sm.p95FaceInferenceMs, S.NUM2),
      num(t.recordingDurationMs / 1000, S.NUM2),
    ]);
  }

  const lastCol = colName(TRIAL_HEADERS.length - 1);
  return {
    name: 'Trial Summary',
    rows,
    widths: TRIAL_WIDTHS,
    // Keep the panel AND the header visible while scrolling the trials.
    freeze: { row: headerRow },
    autoFilter: `A${headerRow}:${lastCol}${Math.max(headerRow, rows.length)}`,
    rowHeights: { [headerRow - 1]: 30 },
  };
}

const TELEMETRY_HEADERS = [
  'Trial', 'Scenario', 'Rep', 'Elapsed (ms)',
  'Face', 'Head Pose Valid', 'Eye Eligible', 'Eye Ineligible Reason',
  'State Signal Valid',
  'Yaw Raw', 'Yaw Δ', 'Yaw Smoothed',
  'Pitch Raw', 'Pitch Δ', 'Pitch Smoothed',
  'Head Tilt Raw', 'Head Tilt Δ', 'Head Tilt Smoothed',
  'EAR Left', 'EAR Right', 'EAR Mean', 'EAR Relative', 'EAR Smoothed',
  'Yaw Instant Cue', 'Pitch-Up Instant Cue', 'Eye-Closure Instant Cue',
  'Pitch-Down Instant Cue', 'Head-Tilt Instant Cue',
  'Yaw Evidence', 'Pitch-Up Evidence', 'Eye-Closure Evidence',
  'Pitch-Down Support', 'Head-Tilt Support',
  'Yaw Persistence (ms)', 'Pitch-Up Persistence (ms)', 'Eye Persistence (ms)',
  'State', 'Primary Reason', 'Face Inference (ms)', 'FPS',
];

/** Booleans read as YES/NO throughout — one convention, chosen once. */
const yn = (v) => (v === true ? 'YES' : v === false ? 'NO' : null);

/** Sheet 2: measurement → validity → evidence → state, per bounded sample. */
function telemetrySheet(doc) {
  const rows = [TELEMETRY_HEADERS.map((h) => ({ v: h, s: S.HEADER }))];

  for (const t of doc.trials ?? []) {
    const label = scenarioLabel(t);
    for (const x of t.samples ?? []) {
      rows.push([
        t.trialId, label, t.repetition ?? null,
        num(x.relativeTimeMs, S.NUM1),

        yn(x.faceDetected),
        { v: yn(x.headPoseValid), s: x.headPoseValid === false ? S.WARN : S.DEFAULT },
        yn(x.eyeEligible), x.eyeIneligibleReason ?? null,
        { v: yn(x.stateSignalValid), s: x.stateSignalValid === false ? S.WARN : S.DEFAULT },

        num(x.yawRaw, S.NUM2), num(x.yawDelta, S.NUM2), num(x.yawSmoothed, S.NUM2),
        num(x.pitchRaw, S.NUM2), num(x.pitchDelta, S.NUM2), num(x.pitchSmoothed, S.NUM2),
        num(x.rollRaw, S.NUM2), num(x.rollDelta, S.NUM2), num(x.rollSmoothed, S.NUM2),

        num(x.earLeft, S.NUM2), num(x.earRight, S.NUM2), num(x.earMean, S.NUM2),
        num(x.earRelative, S.NUM2), num(x.earSmoothed, S.NUM2),

        { v: yn(x.yawInstantaneous), s: x.yawInstantaneous ? S.WARN : S.DEFAULT },
        { v: yn(x.pitchUpInstantaneous), s: x.pitchUpInstantaneous ? S.WARN : S.DEFAULT },
        { v: yn(x.eyeClosureInstantaneous), s: x.eyeClosureInstantaneous ? S.WARN : S.DEFAULT },
        { v: yn(x.pitchDownInstantaneous), s: x.pitchDownInstantaneous ? S.WARN : S.DEFAULT },
        { v: yn(x.rollInstantaneous), s: x.rollInstantaneous ? S.WARN : S.DEFAULT },

        // Active evidence is what a reader scans for, so only that is tinted.
        { v: yn(x.yawEvidence), s: x.yawEvidence ? S.FAIL : S.DEFAULT },
        { v: yn(x.pitchUpEvidence), s: x.pitchUpEvidence ? S.FAIL : S.DEFAULT },
        { v: yn(x.eyeClosureEvidence), s: x.eyeClosureEvidence ? S.FAIL : S.DEFAULT },
        { v: yn(x.pitchDownSupport), s: x.pitchDownSupport ? S.WARN : S.DEFAULT },
        { v: yn(x.rollSupport), s: x.rollSupport ? S.WARN : S.DEFAULT },

        num(x.yawPersistenceMs, S.NUM1), num(x.pitchPersistenceMs, S.NUM1),
        num(x.eyePersistenceMs, S.NUM1),

        x.publicState ?? null, x.primaryReason ?? null,
        num(x.faceInferenceMs, S.NUM2), num(x.fps, S.NUM1),
      ]);
    }
  }

  const lastCol = colName(TELEMETRY_HEADERS.length - 1);
  return {
    name: 'Telemetry',
    rows,
    widths: [
      26, 28, 6, 13,
      8, 16, 13, 24, 18,
      10, 10, 13, 10, 10, 13, 13, 12, 17,
      10, 10, 10, 12, 13,
      16, 20, 24, 22, 20,
      13, 17, 20, 18, 17,
      19, 23, 20,
      13, 18, 18, 8,
    ],
    // Identity and time stay put while scrolling right through the signals.
    freeze: { row: 1, col: 3 },
    autoFilter: `A1:${lastCol}${Math.max(1, rows.length)}`,
    rowHeights: { 0: 30 },
  };
}

/**
 * Build debug_report.xlsx from the master JSON document.
 * @param {Object} doc  the object `buildResultsJson()` returns
 * @param {Date} [now]
 */
export function buildDebugReport(doc, now = new Date()) {
  return buildXlsx([trialSummarySheet(doc), telemetrySheet(doc)], now);
}

export default buildDebugReport;
