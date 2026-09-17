/**
 * Export integrity and trial validity (spec §20, §21).
 *
 * A dry-run export revealed provenance bugs that all shared one shape: the
 * exporter reconstructed at export time something that should have been
 * captured at the moment it was true. A calibration read at export belongs to
 * whoever calibrated last; a timestamp read at save time cannot describe a
 * window that already closed.
 *
 * These tests change no threshold, choose no winner, and fabricate nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DebugSession, summariseTrial, evaluateTrialValidity, TrialValidity,
  signalRequirementFor, MIN_VALID_SIGNAL_RATIO,
} from '../tools/debug/DebugSession.js';
import { getScenario } from '../tools/debug/scenarios.js';
import { BenchmarkRunner } from '../tools/benchmark/BenchmarkRunner.js';
import {
  buildExportBundle, deriveEnvironment, TRIAL_COLUMNS,
  buildModelSummaries, MODEL_SUMMARY_COLUMNS,
} from '../tools/benchmark/exportResults.js';
import { BENCH_SCORE_THRESHOLD } from '../tools/benchmark/candidates.js';

// ══ DEBUG ═══════════════════════════════════════════════════════════════
const CAL = (yaw, at) => ({
  status: 'VALID', valid: true, capturedAtIso: at,
  baseline: { yaw, pitch: -6.8, roll: 0.4, ear: 0.412, sampleCount: 149 },
});
const sample = (o = {}) => ({
  yawDelta: 1.2, pitchDelta: 0.4, rollDelta: 0.1, earRelative: 0.96,
  faceDetected: true, headPoseValid: true, eyeEligible: true,
  stateSignalValid: true, publicState: 'FOKUS', primaryReason: 'NONE',
  fps: 30, faceInferenceMs: 11, relativeTimeMs: 0, ...o,
});
const trial = (over = {}) => ({
  trialId: 't1', scenario: 'NEUTRAL_FRONTAL', repetition: 1,
  expectedSemanticOutcome: 'x', recordingDurationMs: 10000, sampleCount: 3,
  samples: [sample(), sample(), sample()], ...over,
});

test('E1. calibration is snapshotted per trial, not read at export', () => {
  const s = new DebugSession();
  const sc = getScenario('NEUTRAL_FRONTAL');
  const first = s.addTrial(trial(), sc, CAL(-2.5, '2026-09-17T01:00:00.000Z'));
  // Recalibrating must not rewrite a trial that already happened.
  s.calibrationSnapshot = CAL(44, '2026-09-17T02:00:00.000Z');
  const second = s.addTrial(trial({ trialId: 't2', repetition: 2 }), sc,
    CAL(44, '2026-09-17T02:00:00.000Z'));

  assert.equal(first.calibrationAtStart.baseline.yaw, -2.5);
  assert.equal(second.calibrationAtStart.baseline.yaw, 44);

  // The baseline itself lives in the JSON master; the analysis table carries
  // only the flag an analyst needs while filtering rows.
  const doc = s.buildResultsJson({});
  assert.equal(doc.trials[0].calibrationAtStart.baseline.yaw, -2.5,
    'trial 1 keeps its own baseline in the master record');
  assert.equal(doc.trials[1].calibrationAtStart.baseline.yaw, 44);

  const csv = s.buildTrialsCsv();
  const head = csv.split('\n')[0].split(',');
  const rows = csv.split('\n').slice(1).map((r) => r.split(','));
  assert.equal(rows[0][head.indexOf('calibration_valid_at_start')], 'true');
});

test('E2. a trial without a snapshot is never back-filled', () => {
  const s = new DebugSession();
  s.calibrationSnapshot = CAL(44, '2026-09-17T02:00:00.000Z');
  s.addTrial(trial(), getScenario('NEUTRAL_FRONTAL'), null);
  // The session HAS a calibration; the trial did not record one. Blank is the
  // only honest answer, in the master record and in the table alike.
  assert.equal(s.buildResultsJson({}).trials[0].calibrationAtStart, null);
  const csv = s.buildTrialsCsv();
  const head = csv.split('\n')[0].split(',');
  const row = csv.split('\n')[1].split(',');
  assert.equal(row[head.indexOf('calibration_valid_at_start')], '');
});

test('E3. official Start Trial requires valid calibration', async () => {
  const { DebugHarness } = await import('../tools/debug/DebugHarness.js');
  const els = {};
  for (const k of ['video', 'status']) els[k] = { textContent: '', style: {} };
  const h = new DebugHarness({ FilesetResolver: {}, FaceLandmarker: {} }, els);
  h.trials.cameraStarted();
  h.trials.selectScenario(getScenario('NEUTRAL_FRONTAL'));

  h.ai.getCalibrationSnapshot = () => ({ status: 'NONE', baseline: null });
  const blocked = h.startTrial();
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /Calibration required/i);
  assert.equal(h.canStartTrial(), false);

  h.ai.getCalibrationSnapshot = () => CAL(-2.5, '2026-09-17T01:00:00.000Z');
  assert.equal(h.canStartTrial(), true);
  assert.equal(h.startTrial().ok, true);
  assert.equal(h._pendingCalibration.baseline.yaw, -2.5,
    'the snapshot is taken at Start Trial');
});

test('E4. unusable signals cannot PASS a verification trial', () => {
  const dead = () => sample({ yawDelta: null, headPoseValid: false,
    stateSignalValid: false });
  const sm = summariseTrial(
    { samples: [dead(), dead(), dead()] },
    getScenario('YAW_LEFT_SUSTAINED'));
  assert.equal(sm.trialValidity, TrialValidity.INVALID_SIGNAL);
  // The bug: "nothing fired" was scored as a correct negative.
  assert.equal(sm.matchesExpectation, null,
    'no verdict may be claimed without usable evidence');
  assert.ok(sm.trialValidityReason.includes('HEAD_POSE'));
});

test('E5. validity is scenario-specific', () => {
  assert.equal(signalRequirementFor('YAW_LEFT_SUSTAINED'), 'HEAD_POSE');
  assert.equal(signalRequirementFor('SUSTAINED_EYE_CLOSURE'), 'EYE');
  assert.equal(signalRequirementFor('FACE_DROPOUT_RECOVERY'), 'DROPOUT');
  assert.equal(signalRequirementFor('NEUTRAL_FRONTAL'), 'BEHAVIOURAL');

  // Eye closure needs the EYE signal; a valid head pose is not a substitute.
  const noEye = sample({ eyeEligible: false, earRelative: null });
  const eyeSm = summariseTrial({ samples: [noEye, noEye] },
    getScenario('SUSTAINED_EYE_CLOSURE'));
  assert.equal(eyeSm.trialValidity, TrialValidity.INVALID_SIGNAL);
});

test('E6. a dropout scenario is not invalidated by its own dropout', () => {
  // Signal loss IS the measurement here, so the usual floor would reject the
  // very behaviour the scenario exists to observe.
  const ok = () => sample();
  const lost = () => sample({ stateSignalValid: false, faceDetected: false });
  const samples = [ok(), ok(), ok(), lost(), lost(), lost(), lost(), ok(), ok(), ok()];
  const sm = summariseTrial({ samples }, getScenario('FACE_DROPOUT_RECOVERY'));
  assert.equal(sm.trialValidity, TrialValidity.VALID,
    'a real dropout must not invalidate the dropout scenario');
  assert.equal(sm.validSignalRatio, 0.6);

  // A long dropout with a usable stretch either side: 30% valid clears the
  // dropout floor but not the steady-signal floor, which is the whole point
  // of having two.
  const longGap = [ok(), ok(), ok(), ...Array.from({ length: 7 }, lost)];
  assert.equal(summariseTrial({ samples: longGap },
    getScenario('FACE_DROPOUT_RECOVERY')).trialValidity, TrialValidity.VALID);
  assert.equal(summariseTrial({ samples: longGap },
    getScenario('NEUTRAL_FRONTAL')).trialValidity, TrialValidity.INVALID_SIGNAL,
    'the same ratio is not acceptable for a scenario that needs steady signal');

  // But a trial that never recovered is invalid even as a dropout scenario.
  const neverBack = [ok(), ...Array.from({ length: 19 }, lost)];
  assert.equal(summariseTrial({ samples: neverBack },
    getScenario('FACE_DROPOUT_RECOVERY')).trialValidity,
    TrialValidity.INVALID_SIGNAL, 'a dropout that never recovers proves nothing');
});

test('E7. invalid calibration blocks a PASS even with good signal', () => {
  const v = evaluateTrialValidity([sample(), sample()],
    getScenario('NEUTRAL_FRONTAL'), { valid: false, status: 'FAILED' });
  assert.equal(v.trialValidity, TrialValidity.INVALID_CALIBRATION);
});

test('E8. null stays null; a real zero stays zero', () => {
  const none = summariseTrial({ samples: [
    sample({ yawDelta: null, pitchDelta: null, rollDelta: null, earRelative: null }),
    sample({ yawDelta: null, pitchDelta: null, rollDelta: null, earRelative: null }),
  ] }, getScenario('NEUTRAL_FRONTAL'));
  // Math.abs(null) is 0 — mapping before filtering turned "never measured"
  // into "measured exactly zero".
  assert.equal(none.maxYawDelta, null);
  assert.equal(none.maxRollDelta, null);
  assert.equal(none.minEarRelative, null);

  const zeros = summariseTrial({ samples: [
    sample({ yawDelta: 0, pitchDelta: 0, rollDelta: 0, earRelative: 0 }),
  ] }, getScenario('NEUTRAL_FRONTAL'));
  assert.equal(zeros.maxYawDelta, 0, 'a genuine zero survives');
  assert.equal(zeros.minEarRelative, 0);

  const mixed = summariseTrial({ samples: [
    sample({ yawDelta: null }), sample({ yawDelta: -3 }), sample({ yawDelta: 1 }),
  ] }, getScenario('NEUTRAL_FRONTAL'));
  assert.equal(mixed.maxYawDelta, 3, 'valid values are still reduced');

  assert.equal(summariseTrial({ samples: [] },
    getScenario('NEUTRAL_FRONTAL')).maxYawDelta, null, 'empty window');
});

test('E9. debug timestamps describe the real window', () => {
  const s = new DebugSession();
  const t = s.addTrial(trial({ recordingDurationMs: 10000 }),
    getScenario('NEUTRAL_FRONTAL'), CAL(-2.5, 'x'));
  assert.notEqual(t.recordingStartedAtIso, t.recordingEndedAtIso);
  const span = Date.parse(t.recordingEndedAtIso) - Date.parse(t.recordingStartedAtIso);
  assert.ok(Math.abs(span - 10000) < 100, `span ${span} should track duration`);
  assert.ok(Date.parse(t.recordingEndedAtIso) >= Date.parse(t.recordingStartedAtIso));
});

test('E10. registry metadata reaches the trial and the CSV', () => {
  const s = new DebugSession();
  const t = s.addTrial(trial(), getScenario('NEUTRAL_FRONTAL'), CAL(-2.5, 'x'));
  assert.equal(t.scenarioCode, 'D01');
  assert.equal(t.scenarioName, 'Neutral frontal');
  assert.equal(t.scenarioCategory, 'BASELINE');
  const csv = s.buildTrialsCsv({});
  const head = csv.split('\n')[0].split(',');
  const row = csv.split('\n')[1].split(',');
  assert.equal(row[head.indexOf('scenario_code')], 'D01');
  assert.equal(row[head.indexOf('scenario_name')], 'Neutral frontal');
  assert.equal(row[head.indexOf('scenario_category')], 'BASELINE');
});

test('E11. the debug CSV leads with identity and validity', () => {
  const head = new DebugSession().buildTrialsCsv({}).split('\n')[0].split(',');
  assert.equal(head[0], 'session_id');
  assert.equal(head[1], 'trial_id');
  assert.ok(head.indexOf('trial_validity') < head.indexOf('max_abs_yaw_delta_deg'),
    'validity must be read before the numbers it qualifies');
  assert.ok(head.indexOf('scenario_code') < head.indexOf('trial_validity'),
    'identity precedes validity');
  // Session/browser clutter is gone from the analysis table.
  for (const gone of ['user_agent', 'viewport', 'schema_version', 'page_mode']) {
    assert.ok(!head.includes(gone), `${gone} belongs in the JSON, not every row`);
  }
});

// ══ BENCHMARK ═══════════════════════════════════════════════════════════
const benchSamples = () => Array.from({ length: 90 }, (_, i) => ({
  timestampMs: 1000 + i * 33, personDetected: true,
  personMaxScore: i === 45 ? 0.91 : 0.40,
  phoneDetected: false, phoneMaxScore: 0.03,
  // The competitor spikes AWAY from the target-peak frame.
  topOther: i === 10 ? [{ categoryName: 'chair', score: 0.77 }]
                     : [{ categoryName: 'book', score: 0.09 }],
  rawCount: 4, inferenceMs: 15 + (i % 5),
}));

function benchTrial(over = {}) {
  const r = new BenchmarkRunner({}, {});
  const samples = benchSamples();
  const obs = BenchmarkRunner.peak(samples);
  Object.assign(obs, { modelId: 'edl0-f16', delegate: 'GPU',
    videoWidth: 640, videoHeight: 480 });
  const t = r.recordTrial({ task: 'person', scenarioId: 'frontal_seated',
    expected: true, observation: obs, samples, phase: 'DEVELOPMENT',
    startedAtIso: '2026-09-17T03:00:00.000Z',
    endedAtIso: '2026-09-17T03:00:03.000Z', ...over });
  t.durationMs = 3000;
  t.sampleCount = samples.length;
  return { r, t };
}

test('E12. benchmark timestamps describe the real window', () => {
  const { t } = benchTrial();
  assert.notEqual(t.recordingStartedAtIso, t.recordingEndedAtIso);
  assert.equal(
    Date.parse(t.recordingEndedAtIso) - Date.parse(t.recordingStartedAtIso), 3000);
});

test('E13. DEVELOPMENT metrics declare their basis', () => {
  const { t } = benchTrial();
  assert.equal(t.metricBasis, 'DIAGNOSTIC_FLOOR');
  assert.equal(t.diagnosticFloor, BENCH_SCORE_THRESHOLD);
  assert.equal(t.operatingThreshold, null);
  assert.equal(t.operatingThresholdStatus, 'NOT_FROZEN');
  assert.equal(t.metricsStatus, 'PRELIMINARY');
  // Explicit fields, so the generic `detected` cannot be read as a decision.
  assert.equal(t.detectedAtDiagnosticFloor, true);
  assert.equal(t.falsePositiveAtDiagnosticFloor, false);
});

test('E14. VALIDATION does not auto-promote metrics to final', () => {
  const { t } = benchTrial({ phase: 'VALIDATION' });
  assert.equal(t.metricBasis, 'FROZEN_OPERATING_THRESHOLD');
  assert.equal(t.operatingThresholdStatus, 'FROZEN');
  // Coverage rules still apply; phase alone is not completion.
  assert.equal(t.metricsStatus, 'PENDING_COVERAGE');
  assert.notEqual(t.metricsStatus, 'FINAL');
});

test('E15. the competitor summary spans the whole bounded window', () => {
  // Reading only the peak-target frame hid a competitor that spiked elsewhere
  // — exactly the false-positive behaviour H10 exists to expose.
  const { t } = benchTrial();
  assert.equal(t.competingClass, 'chair');
  assert.equal(t.competingScore, 0.77);
});

test('E16. the session environment is derived, never fabricated', () => {
  const { r } = benchTrial();
  const json = JSON.parse(buildExportBundle({ trials: r.getTrials(),
    session: { sessionId: 's1', requiredRepetitions: 3 } })
    .files.find((f) => f.name.endsWith('.json')).content);
  assert.equal(json.environment.videoWidth, 640);
  assert.equal(json.environment.videoHeight, 480);
  assert.equal(json.environment.delegate, 'GPU');
  assert.equal(json.environment.environmentStable, true);

  // Nothing to derive from must stay null, not guess.
  const empty = deriveEnvironment([], {});
  assert.equal(empty.videoWidth, null);
  assert.match(empty.note, /No trials yet/);
});

test('E17. a changed environment is reported as MIXED', () => {
  const r = new BenchmarkRunner({}, {});
  for (const [w, h] of [[640, 480], [1280, 720]]) {
    const obs = BenchmarkRunner.peak(benchSamples());
    Object.assign(obs, { modelId: 'edl0-f16', delegate: 'GPU',
      videoWidth: w, videoHeight: h });
    r.recordTrial({ task: 'person', scenarioId: 'frontal_seated', expected: true,
      observation: obs, samples: benchSamples(), phase: 'DEVELOPMENT' });
  }
  const env = deriveEnvironment(r.getTrials(), {});
  assert.equal(env.videoWidth, 'MIXED');
  assert.equal(env.environmentStable, false);
  assert.deepEqual(env.observed.videoWidth, [640, 1280]);
  assert.match(env.note, /trial-level values are authoritative/i);
});

test('E18. the benchmark CSV leads with identity and ground truth', () => {
  assert.equal(TRIAL_COLUMNS[0], 'session_id');
  assert.equal(TRIAL_COLUMNS[1], 'trial_id');
  assert.equal(TRIAL_COLUMNS[2], 'phase');
  assert.ok(TRIAL_COLUMNS.indexOf('ground_truth')
    < TRIAL_COLUMNS.indexOf('peak_target_score'),
    'truth must be read before the observation it judges');
  // Legacy aliases must not reappear in the human table.
  for (const gone of ['max_target_score', 'detection_result', 'false_positive']) {
    assert.ok(!TRIAL_COLUMNS.includes(gone), `${gone} is an ambiguous alias`);
  }
});

test('E19. the workbook agrees with the JSON master', () => {
  const { r, t } = benchTrial();
  const b = buildExportBundle({ trials: r.getTrials(),
    session: { sessionId: 's1', requiredRepetitions: 3 } });
  const json = JSON.parse(b.files.find((f) => f.name.endsWith('.json')).content);
  const book = new TextDecoder().decode(
    b.files.find((f) => f.name.endsWith('.xlsx')).content);

  // The workbook is built FROM the same document, so equality is structural
  // rather than coincidental — but check the values a reader actually sees.
  assert.equal(json.trials[0].trialId, t.trialId);
  assert.ok(book.includes(t.trialId), 'the trial id appears in the workbook');
  assert.ok(book.includes('DEVELOPMENT'));
  assert.ok(book.includes('DIAGNOSTIC_FLOOR'));
  assert.ok(book.includes('PRELIMINARY'));
  assert.ok(book.includes('NOT FROZEN') || book.includes('NOT_FROZEN'));
  assert.equal(json.trials[0].samples.length, 90, 'raw samples retained');
  // Every bounded sample reaches the Raw Samples sheet.
  assert.ok(book.includes('Raw Samples'));
});

test('E20. Pose trials still receive no fabricated object metrics', () => {
  const r = new BenchmarkRunner({}, {});
  const samples = Array.from({ length: 30 }, (_, i) => ({
    timestampMs: 1000 + i * 33, bodyDetected: true, landmarkCount: 33,
    visibleLandmarks: 28, presenceScore: 28 / 33,
    personDetected: true, personMaxScore: 28 / 33,
    phoneDetected: false, phoneMaxScore: null, topOther: [], inferenceMs: 19,
  }));
  const obs = BenchmarkRunner.peak(samples);
  obs.modelId = 'pose-lite';
  const t = r.recordTrial({ task: 'pose', scenarioId: 'frontal_seated',
    expected: true, observation: obs, samples, phase: 'DEVELOPMENT' });
  assert.equal(t.competingClass, null, 'no invented competitor');
  assert.equal(t.samples[5].phoneMaxScore, null, 'no invented phone score');
  assert.equal(t.samples[5].landmarkCount, 33, 'real pose fields kept');
});

// ── Metric readiness (spec §3) ─────────────────────────────────────────
const posTrial = (i) => ({ modelId: 'edl0-f16', task: 'person',
  scenarioId: 'frontal_seated', repetition: i, expectedTargetPresent: true,
  expected: true, detected: true, maxScore: 0.82, inferenceMs: 16,
  falsePositive: false, falseNegative: false, phase: 'DEVELOPMENT' });
const negTrial = (i) => ({ ...posTrial(i), scenarioId: 'empty_frame',
  expectedTargetPresent: false, expected: false, detected: false,
  maxScore: 0.04 });

test('E21. precision is null until a false positive was possible', () => {
  // Precision from positives alone is 1.0 by construction: the model has had
  // no opportunity to produce a false positive, so the number describes the
  // sampling, not the model.
  const only = buildModelSummaries([posTrial(1), posTrial(2), posTrial(3)],
    { requiredRepetitions: 3 })[0];
  assert.equal(only.positiveTrials, 3);
  assert.equal(only.negativeTrials, 0);
  assert.equal(only.recall, 1, 'recall IS reportable from positives');
  assert.equal(only.precision, null, 'precision is not');
  assert.equal(only.specificity, null);
  assert.equal(only.falsePositiveRate, null);
  assert.equal(only.discriminability, null, 'separation needs two distributions');
});

test('E22. metrics become reportable once both classes exist', () => {
  const both = buildModelSummaries(
    [posTrial(1), posTrial(2), posTrial(3), negTrial(1), negTrial(2)],
    { requiredRepetitions: 3 })[0];
  assert.equal(both.recall, 1);
  assert.equal(both.specificity, 1);
  assert.equal(both.falsePositiveRate, 0);
  assert.equal(typeof both.precision, 'number');
  assert.equal(both.metricReadiness.precisionReady, true);
});

test('E23. recall is null without positive evidence', () => {
  const negOnly = buildModelSummaries([negTrial(1), negTrial(2)],
    { requiredRepetitions: 3 })[0];
  assert.equal(negOnly.recall, null);
  assert.equal(negOnly.sensitivity, null);
  assert.equal(negOnly.specificity, 1, 'specificity IS reportable');
  assert.equal(negOnly.precision, null);
  // Unavailable is null — never 0, 1 or "Not applicable".
  for (const v of [negOnly.recall, negOnly.precision]) {
    assert.notEqual(v, 0);
    assert.notEqual(v, 1);
    assert.notEqual(v, 'Not applicable');
  }
});

test('E24. DEVELOPMENT stays preliminary even with both classes', () => {
  const trials = [posTrial(1), posTrial(2), posTrial(3), negTrial(1)];
  const book = new TextDecoder().decode(
    buildExportBundle({ trials, session: { sessionId: 's', requiredRepetitions: 3 } })
      .files.find((f) => f.name.endsWith('.xlsx')).content);
  // Having both classes makes the metrics computable; it does not make them
  // final. The basis must still be stated on the face of the report.
  assert.ok(book.includes('DEVELOPMENT'));
  assert.ok(book.includes('PRELIMINARY'));
  assert.ok(book.includes('NOT FROZEN'));
  assert.ok(book.includes('diagnostic-floor results, not final'),
    'the workbook must say what these numbers are');
});

test('E25. the summary exports one metric per concept, and no winner', () => {
  // sensitivity == recall; exporting both invites a reader to treat them as
  // independent corroboration.
  assert.ok(!MODEL_SUMMARY_COLUMNS.includes('sensitivity'));
  assert.ok(MODEL_SUMMARY_COLUMNS.includes('recall'));
  for (const gone of ['rank', 'recommended_for_task', 'winner',
                      'final_recommendation']) {
    assert.ok(!MODEL_SUMMARY_COLUMNS.includes(gone),
      `${gone} must not appear in a DEVELOPMENT summary`);
  }
});

test('E26. Pose rows carry no fabricated object metrics', () => {
  const r = new BenchmarkRunner({}, {});
  const samples = Array.from({ length: 20 }, (_, i) => ({
    timestampMs: 1000 + i * 33, elapsedMs: i * 33, bodyDetected: true,
    landmarkCount: 33, visibleLandmarks: 28, presenceScore: 28 / 33,
    personDetected: true, personMaxScore: 28 / 33,
    phoneDetected: false, phoneMaxScore: null, topOther: [], inferenceMs: 19,
  }));
  const obs = BenchmarkRunner.peak(samples);
  obs.modelId = 'pose-lite';
  const t = r.recordTrial({ task: 'pose', scenarioId: 'frontal_seated',
    expected: true, observation: obs, samples, phase: 'DEVELOPMENT' });

  // Nothing is invented at the source...
  assert.equal(t.competingClass, null);
  assert.equal(t.samples[5].phoneMaxScore, null);
  assert.equal(t.samples[5].landmarkCount, 33, 'real pose fields kept');

  // ...and the Overview marks object-score concepts N/A rather than guessing.
  const book = new TextDecoder().decode(
    buildExportBundle({ trials: r.getTrials(),
      session: { sessionId: 's', requiredRepetitions: 3 } })
      .files.find((f) => f.name.endsWith('.xlsx')).content);
  assert.ok(book.includes('N/A'),
    'a metric that does not apply to pose is marked N/A, not zero');
});

test('E27. each ZIP holds exactly JSON + XLSX', () => {
  const b = buildExportBundle({ trials: [posTrial(1)],
    session: { sessionId: 's', requiredRepetitions: 3 } });
  assert.deepEqual(b.files.map((f) => f.name).sort(),
    ['benchmark_report.xlsx', 'benchmark_results.json']);
  const d = new DebugSession().buildExportBundle({});
  assert.deepEqual(d.files.map((f) => f.name).sort(),
    ['debug_report.xlsx', 'debug_results.json']);
  // We are simplifying, not proliferating.
  for (const bundle of [b, d]) {
    assert.equal(bundle.files.length, 2);
    assert.ok(!bundle.files.some((f) => /\.csv$|readme|manifest/i.test(f.name)));
  }
});

// ── Start Trial gate: UI affordance AND runtime guard (spec §1, §28) ────
test('E28. the page derives the Start Trial gate from calibration', () => {
  const html = readFileSync(
    new URL('../public/index.html', import.meta.url), 'utf8');
  const js = html.slice(html.indexOf('<script type="module">'));

  // One function owns the decision; three scattered assignments each had their
  // own idea of the precondition and none checked calibration.
  assert.match(js, /function syncStartGate\(\)/);
  assert.match(js, /const calibrated = harness\.canStartTrial\(\)/,
    'the gate must consult the harness, not assume');
  assert.match(js, /id\('btnStartTrial'\)\.disabled = blocked/);

  // No other code may set the button state behind the gate's back.
  const assignments = js.match(/id\('btnStartTrial'\)\.disabled\s*=/g) ?? [];
  assert.equal(assignments.length, 1,
    `exactly one writer for the button state, found ${assignments.length}`);

  // The reason is stated, not just enforced.
  assert.match(js, /Calibration required before Verification Trial/);

  // Re-evaluated when calibration can change: after calibrate, after reset,
  // and every frame (calibration can lapse mid-session).
  assert.match(js, /setTimeout\(syncStartGate/, 'after calibration completes');
  assert.ok((js.match(/syncStartGate\(\)/g) ?? []).length >= 4,
    'the gate must be re-applied, not computed once');
});

test('E29. the runtime guard refuses regardless of the UI', async () => {
  // Both layers exist on purpose: the UI explains, the harness enforces. A
  // click-time-only guard would let a mis-wired button record an official
  // trial with no baseline.
  const { DebugHarness } = await import('../tools/debug/DebugHarness.js');
  const els = { video: { textContent: '' }, status: { textContent: '' } };
  const h = new DebugHarness({ FilesetResolver: {}, FaceLandmarker: {} }, els);
  h.trials.cameraStarted();
  h.trials.selectScenario(getScenario('NEUTRAL_FRONTAL'));

  h.ai.getCalibrationSnapshot = () => ({ status: 'NONE', baseline: null });
  assert.equal(h.canStartTrial(), false);
  assert.equal(h.startTrial().ok, false, 'a direct call is still refused');

  h.ai.getCalibrationSnapshot = () => ({ status: 'FAILED', baseline: null });
  assert.equal(h.canStartTrial(), false, 'a FAILED calibration is not valid');

  h.ai.getCalibrationSnapshot = () => CAL(-2.5, 'x');
  assert.equal(h.canStartTrial(), true);
  assert.equal(h.startTrial().ok, true);

  // Losing calibration closes the gate again immediately.
  h.ai.getCalibrationSnapshot = () => ({ status: 'NONE', baseline: null });
  assert.equal(h.canStartTrial(), false, 'reset re-closes the gate');
});
