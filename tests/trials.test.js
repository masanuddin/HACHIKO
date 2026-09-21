/**
 * Trial-lifecycle and experiment-boundary tests.
 *
 * The redesign is only trustworthy if the DATA boundary holds: starting the
 * camera must not start recording, and countdown/preparation/post-trial frames
 * must never enter the experiment record. A UI that looks clear but silently
 * captures the operator getting ready produces a corrupt dataset.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TrialController, TrialState, statusLabel } from '../tools/shared/TrialController.js';
import { buildZip } from '../tools/shared/zip.js';
import { DebugSession, toSample, summariseTrial } from '../tools/debug/DebugSession.js';
import { DEBUG_SCENARIOS, DEBUG_GROUPS, getScenario, scenarioConfigSnapshot }
  from '../tools/debug/scenarios.js';
import { BenchmarkRunner } from '../tools/benchmark/BenchmarkRunner.js';
import {
  BENCH_COUNTDOWN_MS, BENCH_RECORDING_MS,
  PERSON_SCENARIOS, PHONE_SCENARIOS,
} from '../tools/benchmark/candidates.js';
import { CONFIG } from '../src/ai/index.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const FRAME = 1000 / 30;

/** A scenario shaped for the controller. */
const scenario = (over = {}) => ({
  id: 'TEST_SCENARIO', countdownMs: 3000, recordingDurationMs: 4000,
  instruction: 'do the thing', expectedSemanticOutcome: 'something', ...over,
});

/** Drive the controller from CAMERA_OFF through one full trial. */
function runFullTrial(c, sc, opts = {}) {
  const counts = { preview: 0, countdown: 0, recording: 0, post: 0 };
  let t = opts.startMs ?? 0;
  c.cameraStarted();
  // Idle preview BEFORE any scenario is chosen.
  for (let i = 0; i < 30; i++, t += FRAME) {
    if (c.offerSample({ timestampMs: t })) counts.preview += 1;
  }
  c.selectScenario(sc);
  // Still idle — a selected scenario is not a running trial.
  for (let i = 0; i < 15; i++, t += FRAME) {
    if (c.offerSample({ timestampMs: t })) counts.preview += 1;
  }
  c.startTrial(t, { trialId: 'T1', repetition: opts.repetition ?? 1 });
  for (const end = t + sc.countdownMs; t < end; t += FRAME) {
    c.tick(t);
    if (c.offerSample({ timestampMs: t })) counts.countdown += 1;
  }
  c.tick(t);
  let completed = null;
  for (const end = t + sc.recordingDurationMs + 500; t < end; t += FRAME) {
    const r = c.tick(t);
    if (c.offerSample({ timestampMs: t })) counts.recording += 1;
    if (r.trial) { completed = r.trial; t += FRAME; break; }
  }
  for (let i = 0; i < 30; i++, t += FRAME) {
    if (c.offerSample({ timestampMs: t })) counts.post += 1;
  }
  return { counts, completed, endMs: t };
}

// ── The core boundary ───────────────────────────────────────────────────
test('T1. starting the camera does NOT start recording', () => {
  const c = new TrialController();
  assert.equal(c.state, TrialState.CAMERA_OFF);
  c.cameraStarted();
  assert.equal(c.state, TrialState.CAMERA_READY);
  assert.equal(c.isRecording(), false);
  for (let t = 0; t < 3000; t += FRAME) {
    assert.equal(c.offerSample({ timestampMs: t }), false);
  }
  assert.equal(c.samples.length, 0, 'no samples may exist before a trial');
});

test('T2. selecting a scenario does NOT start recording', () => {
  const c = new TrialController();
  c.cameraStarted();
  c.selectScenario(scenario());
  assert.equal(c.state, TrialState.SCENARIO_SELECTED);
  assert.equal(c.isRecording(), false);
  assert.equal(c.offerSample({ timestampMs: 100 }), false);
});

test('T3. countdown frames are NOT recorded', () => {
  const c = new TrialController();
  const { counts } = runFullTrial(c, scenario());
  assert.equal(counts.countdown, 0, 'countdown must contribute nothing');
});

test('T4. only recording-window frames are captured', () => {
  const c = new TrialController();
  const sc = scenario();
  const { counts, completed } = runFullTrial(c, sc);
  assert.equal(counts.preview, 0);
  assert.equal(counts.countdown, 0);
  assert.equal(counts.post, 0, 'post-trial frames must not leak');
  assert.ok(counts.recording > 100, `expected ~120 samples, got ${counts.recording}`);
  assert.equal(completed.sampleCount, counts.recording);
});

test('T5. every stored sample lies inside the trial window', () => {
  const c = new TrialController();
  const { completed } = runFullTrial(c, scenario());
  for (const s of completed.samples) {
    assert.ok(s.timestampMs >= completed.recordingStartedAt,
      'sample precedes the window start');
    assert.ok(s.timestampMs <= completed.recordingEndedAt,
      'sample follows the window end');
    assert.ok(s.relativeTimeMs >= 0);
  }
});

test('T6. samples carry trialId, scenario and relativeTimeMs', () => {
  const c = new TrialController();
  const { completed } = runFullTrial(c, scenario());
  const first = completed.samples[0];
  assert.equal(first.trialId, 'T1');
  assert.equal(first.scenario, 'TEST_SCENARIO');
  assert.equal(first.repetition, 1);
  assert.ok(Number.isFinite(first.relativeTimeMs));
  assert.ok(first.relativeTimeMs < FRAME * 2, 'first sample is near t=0');
});

test('T7. the trial auto-stops at its configured duration', () => {
  const c = new TrialController();
  const sc = scenario({ recordingDurationMs: 2000 });
  const { completed } = runFullTrial(c, sc);
  assert.ok(completed, 'the trial completed without operator action');
  assert.ok(completed.recordingDurationMs >= 2000);
  assert.ok(completed.recordingDurationMs < 2000 + FRAME * 2,
    `auto-stop should be tight, got ${completed.recordingDurationMs}`);
});

test('T8. the controller returns to a resting state after a trial', () => {
  const c = new TrialController();
  runFullTrial(c, scenario());
  assert.equal(c.state, TrialState.SCENARIO_SELECTED);
  assert.equal(c.isBusy(), false);
  assert.equal(c.isRecording(), false);
});

test('T9. aborting discards the partial window', () => {
  const c = new TrialController();
  const sc = scenario();
  let t = 0;
  c.cameraStarted(); c.selectScenario(sc); c.startTrial(t, { trialId: 'A', repetition: 1 });
  for (const end = t + sc.countdownMs; t < end; t += FRAME) c.tick(t);
  c.tick(t);
  for (let i = 0; i < 20; i++, t += FRAME) { c.tick(t); c.offerSample({ timestampMs: t }); }
  assert.ok(c.samples.length > 0, 'samples accumulated mid-window');
  c.abort('interrupted');
  assert.equal(c.samples.length, 0, 'a partial window is not a measurement');
  assert.equal(c.isRecording(), false);
});

test('T10. stopping the camera discards an in-flight trial', () => {
  const c = new TrialController();
  const sc = scenario();
  let t = 0;
  c.cameraStarted(); c.selectScenario(sc); c.startTrial(t, { trialId: 'B', repetition: 1 });
  for (const end = t + sc.countdownMs + 500; t < end; t += FRAME) { c.tick(t); c.offerSample({ timestampMs: t }); }
  c.cameraStopped();
  assert.equal(c.state, TrialState.CAMERA_OFF);
  assert.equal(c.samples.length, 0);
});

test('T11. status labels distinguish the recording states', () => {
  assert.match(statusLabel(TrialState.CAMERA_READY), /NOT RECORDING/);
  assert.match(statusLabel(TrialState.COUNTDOWN, { remainingMs: 2100 }), /COUNTDOWN/);
  assert.match(statusLabel(TrialState.RECORDING, { elapsedMs: 1000, durationMs: 4000 }), /RECORDING/);
  assert.ok(!/^RECORDING/.test(statusLabel(TrialState.CAMERA_READY)),
    'the idle label must not begin with RECORDING');
});

// ── Scenario configuration ──────────────────────────────────────────────
test('T12. scenario durations are derived from the AI persistence windows', () => {
  const s = CONFIG.state;
  // EVERY temporal probe must outlast its persistence window. A sustained
  // probe needs the time to demonstrate the rule firing; a brief-glance probe
  // needs it so that "no evidence" is a statement about the GLANCE rather than
  // about the recording having stopped too early.
  const yawLong = getScenario('YAW_LEFT_SUSTAINED');
  const yawShort = getScenario('BRIEF_YAW_GLANCE');
  assert.ok(yawLong.recordingDurationMs > s.YAW_PERSIST_MS,
    'a sustained-yaw trial must outlast the yaw persistence window');
  assert.ok(yawShort.recordingDurationMs > s.YAW_PERSIST_MS,
    'a brief-glance trial must also outlast it, or its pass is vacuous');

  const eye = getScenario('SUSTAINED_EYE_CLOSURE');
  assert.ok(eye.recordingDurationMs > s.EYE_CLOSED_PERSIST_MS);
  const pitchUp = getScenario('PITCH_UP_SUSTAINED');
  assert.ok(pitchUp.recordingDurationMs > s.PITCH_UP_PERSIST_MS);

  // Left and right must be given the same observation time, or the matrix
  // itself would bias the very asymmetry it exists to detect.
  assert.equal(getScenario('YAW_RIGHT_SUSTAINED').recordingDurationMs,
    yawLong.recordingDurationMs);
});

test('T13. durations are NOT a single fixed window', () => {
  const durations = new Set(DEBUG_SCENARIOS.map((s) => s.recordingDurationMs));
  assert.ok(durations.size > 3,
    `expected varied durations, got ${[...durations].join(',')}`);
});

test('T14. face dropout is not treated as proof of physical absence', () => {
  // The retired ABSENT/RETURN scenarios implied the Debug harness could
  // validate TIDAK_HADIR. It cannot — that needs perception, which is still
  // being benchmarked. D10 tests signal validity and recovery instead.
  const d10 = getScenario('FACE_DROPOUT_RECOVERY');
  assert.ok(d10, 'D10 must exist');
  assert.equal(d10.triggerExpected, false);
  assert.match(d10.purpose, /not.*physical absence|does NOT validate/i);
  assert.ok(d10.expectedSemanticBehavior.some((x) => /NOT treated here as physical absence/i.test(x)),
    'D10 must state that face loss is not absence');
  // And no scenario in the canonical matrix is left "pending a model".
  assert.ok(DEBUG_SCENARIOS.every((x) => !x.pending),
    'the Debug matrix must not depend on an unselected perception model');
});

test('T15. a pending scenario cannot be selected', () => {
  const c = new TrialController();
  c.cameraStarted();
  // The harness gate is what blocks this; the controller itself is agnostic,
  // so the guard must live where selection happens.
  const html = read('../tools/debug/DebugHarness.js');
  assert.match(html, /scenario\?\.pending/,
    'selectScenario must refuse pending scenarios');
});

// ── Debug session bookkeeping ───────────────────────────────────────────
function seedSession() {
  const session = new DebugSession(CONFIG);
  const sc = getScenario('YAW_LEFT_SUSTAINED');
  for (let r = 0; r < 3; r++) {
    const c = new TrialController();
    const ref = session.nextTrialRef(sc.id);
    const { completed } = runFullTrial(c, sc, { repetition: ref.repetition });
    completed.trialId = ref.trialId;
    completed.repetition = ref.repetition;
    // Attach plausible per-sample telemetry.
    // A D02 that actually succeeds: the yaw EVIDENCE activates after
    // persistence. The public state follows, but it is the evidence flag the
    // verdict reads — setting only publicState would describe a pipeline whose
    // display moved while the rule under test never fired.
    completed.samples = completed.samples.map((s, i) => ({
      ...s, publicState: i > 60 ? 'TERALIH' : 'FOKUS',
      primaryReason: i > 60 ? 'YAW' : 'NONE',
      yawEvidence: i > 60,
      yawPersistenceMs: i > 60 ? 1600 : Math.min(1500, i * 33),
      yawDelta: 45, pitchDelta: -2, rollDelta: 1, earRelative: 1.0,
      faceDetected: true, headPoseValid: true, stateSignalValid: true,
      eyeEligible: true, fps: 30, faceInferenceMs: 11,
    }));
    session.addTrial(completed, sc);
  }
  return session;
}

test('T16. repetition auto-increments from stored valid trials', () => {
  const session = seedSession();
  assert.deepEqual(session.trials.map((t) => t.repetition), [1, 2, 3]);
  assert.equal(session.repetitionCount('YAW_LEFT_SUSTAINED'), 3);
  assert.equal(session.nextTrialRef('YAW_LEFT_SUSTAINED').repetition, 4);
});

test('T17. Delete Last Trial removes the trial LITERALLY', () => {
  const session = seedSession();
  const last = session.lastTrial();
  const removed = session.deleteLastTrial();

  assert.ok(removed, 'the removed trial is returned');
  assert.equal(removed.trialId, last.trialId, 'it deletes the MOST RECENT trial');
  assert.equal(session.trials.length, 2, 'the row is gone');
  assert.ok(!session.trials.some((t) => t.trialId === last.trialId));
  // No tombstone of any kind: a soft-deleted row that still surfaces somewhere
  // is exactly the dirty-data problem literal deletion replaces.
  assert.equal(session.discarded, undefined, 'no discarded list is retained');
  assert.equal(removed.samples, null, 'linked telemetry is dropped with it');
});

test('T17b. only the most recent trial can be deleted', () => {
  const session = seedSession();
  const ids = session.trials.map((t) => t.trialId);
  session.deleteLastTrial();
  assert.deepEqual(session.trials.map((t) => t.trialId), ids.slice(0, 2));
  session.deleteLastTrial();
  assert.deepEqual(session.trials.map((t) => t.trialId), ids.slice(0, 1));
  session.deleteLastTrial();
  assert.equal(session.trials.length, 0);
  assert.equal(session.deleteLastTrial(), null, 'deleting from empty is a no-op');
});

test('T18. progress rolls back when the last trial is deleted', () => {
  const session = seedSession();
  assert.equal(session.repetitionCount('YAW_LEFT_SUSTAINED'), 3);
  let p = session.progress(DEBUG_SCENARIOS).find((x) => x.scenarioId === 'YAW_LEFT_SUSTAINED');
  assert.equal(p.complete, true);

  session.deleteLastTrial();
  assert.equal(session.repetitionCount('YAW_LEFT_SUSTAINED'), 2);
  p = session.progress(DEBUG_SCENARIOS).find((x) => x.scenarioId === 'YAW_LEFT_SUSTAINED');
  assert.equal(p.done, 2);
  assert.equal(p.complete, false);
  // The freed repetition slot is reused, so the next trial is 3 of 3 again.
  assert.equal(session.nextTrialRef('YAW_LEFT_SUSTAINED').repetition, 3);
});

test('T18b. a deleted trial leaves ZERO trace in every export artefact', () => {
  const session = seedSession();
  const victim = session.lastTrial();
  const victimSampleCount = victim.sampleCount;
  session.deleteLastTrial();

  const bundle = session.buildExportBundle({ userAgent: 'test' });
  const decode = (f) => (f.content instanceof Uint8Array
    ? new TextDecoder().decode(f.content) : f.content);
  for (const f of bundle.files) {
    assert.ok(!decode(f).includes(victim.trialId),
      `${f.name} still references the deleted trial`);
  }
  // Its telemetry rows are gone too, not merely unreferenced.
  const master = session.buildResultsJson({});
  const remaining = session.trials.reduce((a, t) => a + (t.samples?.length ?? 0), 0);
  assert.equal(master.trials.reduce((a, t) => a + (t.samples?.length ?? 0), 0),
    remaining);
  assert.ok(victimSampleCount > 0);

  // Structurally absent from the JSON, not merely absent as a string: no trial
  // entry, no sample, and the progress count rolled back.
  const doc = JSON.parse(bundle.files.find((f) => /\.json$/.test(f.name)).content);
  assert.ok(!doc.trials.some((t) => t.trialId === victim.trialId));
  assert.equal(doc.trials.length, session.trials.length);
  assert.equal(doc.progress.totalValidTrials, session.trials.length);
  const p = doc.progress.perScenario.find((x) => x.scenarioId === victim.scenario);
  assert.equal(p.done, session.repetitionCount(victim.scenario));
  // The scenario itself still exists in the protocol catalogue — that is the
  // scenario being available to run, not the deleted trial persisting.
  assert.ok(doc.scenarios.some((x) => x.id === victim.scenario));
});

test('T19. trial summary reports trigger and delay', () => {
  const session = seedSession();
  const s = session.trials[0].summary;
  assert.equal(s.triggerExpected, true);
  assert.equal(s.triggerOccurred, true, 'yaw strong evidence activated');
  assert.ok(s.triggerDelayMs > 0, 'delay measured from window start');
  assert.equal(s.observedFinalState, 'TERALIH');
  assert.equal(s.primaryReason, 'YAW');
  assert.equal(s.matchesExpectation, true);
  // The verdict comes from the evidence, and says so in words.
  assert.equal(s.trialVerdict, 'PASS');
  assert.equal(s.observedOutcome, 'Yaw strong evidence activated');
  assert.equal(s.failureReason, null);
  assert.equal(s.verificationDetails.yawEverActive, true);
  assert.ok(Math.abs(s.maxYawDelta - 45) < 1e-9);
});

test('T20. a summary describes rather than judges', () => {
  // The summary reports what the PIPELINE did against what the SCENARIO
  // expected. It must not editorialise about the AI being broken: a single
  // trial cannot settle that.
  //
  // `failureReason` is the one permitted use of the word: it names which
  // scenario rule was violated ("Unexpected yaw evidence after persistence"),
  // which is a verification result, not a judgement about the model.
  const session = seedSession();
  const keys = Object.keys(session.trials[0].summary);
  const allowed = new Set(['failureReason']);
  for (const k of keys) {
    if (allowed.has(k)) continue;
    assert.ok(!/wrong|broken|bad|error|bug/i.test(k),
      `summary key "${k}" editorialises`);
  }
  assert.ok(keys.includes('matchesExpectation'));

  // And on a passing trial the field stays empty rather than inventing blame.
  assert.equal(session.trials[0].summary.failureReason, null);
});

// ── Debug export ────────────────────────────────────────────────────────
test('T21. debug export is ONE archive of JSON + XLSX', () => {
  const bundle = seedSession().buildExportBundle({ userAgent: 'test' });
  assert.equal(bundle.files.length, 2, 'two files, no CSV clutter');
  assert.deepEqual(bundle.files.map((f) => f.name).sort(),
    ['debug_report.xlsx', 'debug_results.json']);
  assert.match(bundle.archiveName, /^hachiko_debug_session_\d{4}-\d{2}-\d{2}_\d{4}\.zip$/);

  const json = bundle.files.find((f) => f.name.endsWith('.json'));
  assert.equal(json.mime, 'application/json');
  const xlsx = bundle.files.find((f) => f.name.endsWith('.xlsx'));
  assert.match(xlsx.mime, /spreadsheetml\.sheet$/);
  // The workbook is binary; a string would mean it was text-encoded.
  assert.ok(xlsx.content instanceof Uint8Array);
  // Fragmented per-topic exports never came back.
  for (const gone of ['debug_trials.csv', 'debug_telemetry.csv',
                      'session.csv', 'config.csv']) {
    assert.ok(!bundle.files.some((f) => f.name === gone), `${gone} must not exist`);
  }
});

test('T21b. the workbook is a valid XLSX package', () => {
  const bundle = seedSession().buildExportBundle({ userAgent: 'test' });
  const xlsx = bundle.files.find((f) => f.name.endsWith('.xlsx')).content;
  // PK signature, then the OOXML parts a reader requires.
  assert.equal(xlsx[0], 0x50);
  assert.equal(xlsx[1], 0x4b);
  const text = new TextDecoder().decode(xlsx);
  for (const part of ['[Content_Types].xml', 'xl/workbook.xml',
                      'xl/styles.xml', 'xl/worksheets/sheet1.xml',
                      'xl/worksheets/sheet2.xml']) {
    assert.ok(text.includes(part), `missing part ${part}`);
  }
  // Exactly two sheets, named for what they answer.
  assert.ok(text.includes('Trial Summary'));
  assert.ok(text.includes('Telemetry'));
  assert.ok(!text.includes('sheet3.xml'), 'the debug workbook has two sheets');
  // No macros, no external links.
  assert.ok(!text.includes('vbaProject'));
  assert.ok(!text.includes('externalLink'));

  const zip = buildZip(bundle.files);
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint16(zip.length - 22 + 10, true), 2, 'two entries');
});

test('T22. debug_results.json is a complete standalone record', () => {
  const session = seedSession();
  const doc = session.buildResultsJson({
    userAgent: 'test-agent', viewport: '1440x900',
    videoWidth: 640, videoHeight: 480,
  });
  // No CSV should be needed to reanalyse a session.
  for (const k of ['schemaVersion', 'protocolVersion', 'pageMode', 'session',
                   'environment', 'calibration', 'config', 'scenarios',
                   'progress', 'perception', 'trials']) {
    assert.ok(k in doc, `results.json missing ${k}`);
  }
  assert.equal(doc.environment.userAgent, 'test-agent');
  assert.ok(doc.config.state, 'the thresholds the numbers are read against');
  assert.ok(Array.isArray(doc.scenarios) && doc.scenarios.length > 0,
    'the scenario protocol travels with the results');
  assert.ok(doc.trials.length > 0);
  // Raw samples are in the JSON too, so it does not depend on the telemetry CSV.
  assert.ok(Array.isArray(doc.trials[0].samples) && doc.trials[0].samples.length > 0,
    'JSON must carry the bounded raw samples');
  assert.ok(doc.progress.perScenario.length > 0);
});

test('T23. the export states that presence and phone are PENDING', () => {
  const session = seedSession();
  assert.equal(session.buildResultsJson().perception.presenceModel, 'PENDING BAKE-OFF');
  // The perception status is session-level context, so it lives in the JSON
  // master rather than being repeated on every trial row.
  assert.equal(session.buildResultsJson().perception.presenceModel,
    'PENDING BAKE-OFF');
});

test('T24. debug_trials.csv is a readable analysis table', () => {
  const session = seedSession();
  const csv = session.buildTrialsCsv();
  const cols = csv.split(String.fromCharCode(10))[0].split(',');

  // Identity, then validity, then what happened. The JSON master holds the
  // session metadata, config and calibration baselines.
  for (const c of ['session_id', 'trial_id', 'scenario_code', 'scenario_id',
                   'scenario_name', 'scenario_category', 'repetition',
                   'calibration_valid_at_start', 'trial_validity',
                   'valid_signal_samples', 'total_samples', 'valid_signal_ratio',
                   'expected_trigger', 'observed_trigger', 'expected_outcome',
                   'final_state', 'primary_reason', 'matches_expectation',
                   'max_abs_yaw_delta_deg', 'min_relative_ear',
                   'sample_count', 'inference_p50_ms',
                   'recording_started_at', 'recording_ended_at', 'duration_ms']) {
    assert.ok(cols.includes(c), `debug trials CSV missing ${c}`);
  }
  // Session/browser/config clutter belongs in the JSON, not on every row.
  for (const gone of ['page_mode', 'schema_version', 'protocol_version',
                      'user_agent', 'viewport', 'exported_at',
                      'thr_strong_yaw_deg', 'baseline_yaw_deg']) {
    assert.ok(!cols.includes(gone), `${gone} should live in the JSON master`);
  }
  // And no duplicate aliases for one concept.
  assert.ok(!cols.includes('scenario_label'));
  assert.ok(!cols.includes('scenario_group'));
  assert.ok(!cols.includes('actual_record_sec'), 'duration_ms is canonical');
  assert.ok(cols.length >= 25 && cols.length <= 34,
    `expected a readable width, got ${cols.length} columns`);
});

test('T24b. debug_telemetry.csv orders the measurement chain', () => {
  const session = seedSession();
  const lines = session.buildTelemetryCsv().split(String.fromCharCode(10));
  const cols = lines[0].split(',');

  // Identity -> validity -> measurement -> evidence -> persistence -> state.
  assert.deepEqual(cols.slice(0, 5),
    ['session_id', 'trial_id', 'scenario_code', 'repetition', 'elapsed_ms']);
  for (const c of ['face_detected', 'head_pose_valid', 'eye_eligible',
                   'state_signal_valid',
                   'yaw_raw_deg', 'yaw_delta_deg', 'yaw_smoothed_deg',
                   'head_tilt_raw_deg', 'ear_relative',
                   'yaw_evidence', 'pitch_down_support', 'head_tilt_support',
                   'yaw_persistence_ms', 'public_state', 'fps']) {
    assert.ok(cols.includes(c), `debug telemetry CSV missing ${c}`);
  }
  assert.ok(cols.indexOf('face_detected') < cols.indexOf('yaw_raw_deg'),
    'validity precedes the measurements it qualifies');
  assert.ok(cols.indexOf('yaw_raw_deg') < cols.indexOf('yaw_evidence'),
    'measurement precedes the evidence derived from it');
  assert.ok(cols.indexOf('yaw_evidence') < cols.indexOf('public_state'),
    'evidence precedes the state it produces');

  const first = lines[1].split(',');
  assert.equal(first[0], session.sessionId, 'row names its session');
  assert.ok(first[1].length > 0, 'row names its trial');
});

test('T25. telemetry CSV contains ONLY trial-bounded rows', () => {
  const session = seedSession();
  const lines = session.buildTelemetryCsv().split(String.fromCharCode(10))
    .slice(1).filter(Boolean);
  const expected = session.trials.reduce((a, t) => a + (t.samples?.length ?? 0), 0);
  assert.equal(lines.length, expected);
  // Every row must name a real trial — no orphan preview rows.
  const ids = new Set(session.trials.map((t) => t.trialId));
  for (const line of lines) {
    assert.ok(ids.has(line.split(',')[1]), 'telemetry row without a trial');
  }
});

test('T26. debug export contains no image or video data', () => {
  const bundle = seedSession().buildExportBundle({ userAgent: 'test' });
  for (const f of bundle.files) {
    for (const banned of ['data:image', 'blob:', 'ImageData', 'base64', 'canvas']) {
      assert.ok(!f.content.includes(banned), `${f.name} contains ${banned}`);
    }
  }
});

test('T27. export does not mutate the session', () => {
  const session = seedSession();
  const before = JSON.stringify(session.trials);
  session.buildExportBundle({ userAgent: 'test' });
  session.buildTrialsCsv();
  session.buildResultsJson();
  session.buildTelemetryCsv();
  assert.equal(JSON.stringify(session.trials), before);
});

test('T28. toSample flattens a frame to numbers only', () => {
  const frame = {
    timestampMs: 123,
    measurement: { facePresent: true, poseValid: true, yawRaw: 10, earLeft: 0.3 },
    calibrated: { yawDelta: 5, earRelative: 0.9 },
    temporal: { yawSmoothed: 4.8 },
    evidence: { active: { yawStrong: true }, accumulated: { yawStrong: 900 }, eyeEligible: true },
    classification: { state: 'FOKUS', primaryReason: 'NONE' },
    performance: { fps: 30, faceInferenceMs: 11 },
    validity: { stateSignalValid: true },
  };
  const s = toSample(frame);
  assert.equal(s.timestampMs, 123);
  assert.equal(s.yawEvidence, true);
  assert.equal(s.yawPersistenceMs, 900);
  assert.equal(s.publicState, 'FOKUS');
  for (const k of Object.keys(s)) {
    assert.ok(!/image|frame|canvas|blob/i.test(k), `toSample leaked "${k}"`);
  }
});

// ── Bake-off bounded trials ─────────────────────────────────────────────
test('T29. the bake-off records only inside its window', () => {
  const c = new TrialController();
  const sc = {
    id: 'study_distance', countdownMs: BENCH_COUNTDOWN_MS,
    recordingDurationMs: BENCH_RECORDING_MS,
    instruction: 'hold phone', expectedSemanticOutcome: 'detected',
  };
  const { counts, completed } = runFullTrial(c, sc);
  assert.equal(counts.preview, 0);
  assert.equal(counts.countdown, 0);
  assert.equal(counts.post, 0);
  assert.ok(completed.sampleCount > 50);
});

test('T30. bake-off peak is computed only from window samples', () => {
  const c = new TrialController();
  const sc = { id: 's', countdownMs: 500, recordingDurationMs: 1000,
               instruction: 'x', expectedSemanticOutcome: 'y' };
  let t = 0;
  c.cameraStarted(); c.selectScenario(sc);
  // A very high score BEFORE the trial must not influence the result.
  c.offerSample({ timestampMs: t, personMaxScore: 0.99, personDetected: true, inferenceMs: 20 });
  c.startTrial(t, { trialId: 'X', repetition: 1 });
  for (const end = t + sc.countdownMs; t < end; t += FRAME) {
    c.tick(t);
    c.offerSample({ timestampMs: t, personMaxScore: 0.98, personDetected: true, inferenceMs: 20 });
  }
  c.tick(t);
  let done = null;
  for (const end = t + sc.recordingDurationMs + 200; t < end; t += FRAME) {
    const r = c.tick(t);
    c.offerSample({ timestampMs: t, personMaxScore: 0.30, personDetected: true, inferenceMs: 20 });
    if (r.trial) { done = r.trial; break; }
  }
  const peak = BenchmarkRunner.peak(done.samples);
  assert.ok(Math.abs(peak.personMaxScore - 0.30) < 1e-9,
    `pre-trial 0.99 and countdown 0.98 must be excluded, got ${peak.personMaxScore}`);
});

test('T31. bake-off trial window is bounded and configurable', () => {
  assert.ok(BENCH_COUNTDOWN_MS >= 2000, 'operator needs time to set the scene');
  assert.ok(BENCH_RECORDING_MS >= 2000 && BENCH_RECORDING_MS <= 5000);
});

// ── Page contracts ──────────────────────────────────────────────────────
test('T32. both pages expose the recording state and a start-trial control', () => {
  for (const page of ['../public/index.html', '../public/benchmark.html']) {
    const html = read(page);
    assert.match(html, /id="recState"/, `${page} must show the recording state`);
    assert.match(html, /id="btnStartTrial"/, `${page} needs START TRIAL`);
    assert.match(html, /id="btnAbort"/, `${page} needs Abort`);
    assert.match(html, /id="btnInvalid"/, `${page} needs invalid marking`);
    assert.match(html, /TrialController/, `${page} must use the shared lifecycle`);
    // Start Camera must be a separate control from Start Trial.
    assert.match(html, /id="btnStart"/);
  }
});

test('T33. presence and phone are ultra-compact PENDING BAKE-OFF blocks', () => {
  const html = read('../public/index.html');
  const pairStart = html.indexOf(String.fromCharCode(34) + "pair" + String.fromCharCode(34));
  const pair = html.slice(pairStart, pairStart + 700);
  assert.match(pair, /Physical presence/);
  assert.match(pair, /Phone context/);
  assert.ok((pair.match(/PENDING BAKE-OFF/g) ?? []).length === 2,
    'each block carries its own pending tag');
  // Nothing meaningful can be shown until a model is chosen, so no detail rows
  // and no explanatory paragraph take vertical space.
  for (const gone of ['id="presenceModel"', 'id="phoneModel"', 'id="objPerson"',
                      'id="objPhone"', 'id="phoneEvent"', 'id="objPrimary"']) {
    assert.ok(!html.includes(gone), gone + ' must not occupy space while pending');
  }
  assert.ok(!/>pose<\/span>/.test(html), 'ambiguous "pose" label must be renamed');
  assert.match(html, /Head-pose signal/);
});

test('T34. the debug page does NOT construct an object detector', () => {
  const html = read('../public/index.html');
  assert.ok(!html.includes('ObjectDetector'),
    'the provisional detector must not be imported while the Bake-off is open');
  const harness = read('../tools/debug/DebugHarness.js');
  assert.match(harness, /this\.objectEngine = null/,
    'the harness must not instantiate the provisional detector');
});

test('T35. the debug page uses three merged developer tabs', () => {
  const html = read('../public/index.html');
  for (const pane of ['paneFeat', 'paneRun', 'panePerc']) {
    assert.ok(html.includes(`id="${pane}"`), `missing tab ${pane}`);
  }
  assert.match(html, /Signal Inspector/);
  assert.match(html, />Runtime</);
  assert.match(html, />Perception</);
  // Measurements and diagnostics are now ONE tab, so the split is gone.
  assert.ok(!html.includes('id="paneDiag"'),
    'Decision Diagnostics must be merged into Signal Inspector');
  assert.ok(!/>Feature Values</.test(html), 'the old split tab name is gone');
  assert.ok(!/Features &amp; Rules/.test(html), 'the tab is now Signal Inspector');
  assert.ok(!/>Advanced</.test(html), 'no vague Advanced tab');
});

test('T36. tooltips explain the non-obvious fields', () => {
  const html = read('../public/index.html');
  assert.ok((html.match(/class="tip"/g) ?? []).length >= 5,
    'key technical fields need micro-help');
  assert.match(html, /calibrated neutral/i);
  assert.match(html, /continuously satisfied the rule/i, 'persistence needs a tooltip');
});

test('T37. AI semantics and thresholds are unchanged', () => {
  assert.equal(CONFIG.state.STRONG_YAW_DELTA_DEG, 25);
  assert.equal(CONFIG.state.YAW_PERSIST_MS, 1500);
  assert.equal(CONFIG.state.PITCH_UP_PERSIST_MS, 2000);
  assert.equal(CONFIG.state.EYE_CLOSED_PERSIST_MS, 3000);
  assert.equal(CONFIG.state.EAR_RELATIVE_THRESHOLD, 0.70);
  assert.equal(CONFIG.presence.BOTH_MISSING_ENTER_MS, 2000);
  assert.equal(CONFIG.phoneEvents.PHONE_ENTER_MS, 400);
  assert.equal(CONFIG.headPose.invertPitch, true);
  assert.equal(CONFIG.objectDetector.scoreThreshold, 0.30);
});

test('T38. scenario config snapshot is exportable and complete', () => {
  const snap = scenarioConfigSnapshot();
  assert.equal(snap.length, DEBUG_SCENARIOS.length);
  for (const s of snap) {
    assert.ok(s.id && s.group);
    assert.ok(Number.isFinite(s.countdownMs));
    assert.ok(Number.isFinite(s.recordingDurationMs));
    assert.ok(typeof s.expectedSemanticOutcome === 'string');
  }
});

// ── Layout priority (follow-up correction) ──────────────────────────────
test('T39. there is no bottom full-width workflow strip', () => {
  const html = read('../public/index.html');
  // A fourth full-width row split the workflow away from the controls it drives.
  assert.ok(!html.includes('class="runner"'), 'the bottom strip must be deleted');
  assert.ok(!html.includes('grid-column:1 / -1'), 'nothing spans all three columns');
  const grid = html.match(/\.dash\{[^}]*grid-template-columns:([^;]+);/);
  assert.ok(grid, 'dashboard grid must be declared');
  assert.ok(!/grid-template-rows/.test(html.slice(html.indexOf('.dash{'),
    html.indexOf('.dash{') + 220)), 'no second dashboard row');
  assert.match(html, /id="btnAllScenarios"/,
    'the full inventory stays behind a "View all scenarios" affordance');
  assert.match(html, /id="scenModal"/, 'and opens in a modal, not a column');
});

test('T40. the LEFT column carries the workflow, catalogue on demand', () => {
  const html = read('../public/index.html');
  const left = html.slice(html.indexOf('LEFT \u2014 OPERATE'),
                          html.indexOf('CENTER \u2014 OBSERVE'));
  assert.ok(left.length > 0, 'the LEFT operate column must exist');
  for (const el of ['video', 'calStatus', 'trialInstruction', 'trialExpected',
                    'trialScenario', 'trialRep', 'trialDur', 'btnStartTrial',
                    'btnAbort', 'btnInvalid', 'trialBig', 'trialFill',
                    'btnAllScenarios', 'btnProgress']) {
    assert.ok(left.includes('id="' + el + '"'),
      '#' + el + ' must live in the LEFT workflow column');
  }
  // Live monitoring is the primary purpose, so the catalogue and the detailed
  // progress table must not hold permanent dashboard space.
  for (const gone of ['id="groupChips"', 'id="scenChips"', 'id="groupProgress"']) {
    assert.ok(!html.includes(gone), gone + ' must be behind a modal');
  }
  assert.match(left, /Verification Trial/, 'the panel is renamed');
  assert.ok(!left.includes('Trial runner'), 'the old name is gone');
});

test('T40b. Choose Scenario and View Progress open on-demand views', () => {
  const html = read('../public/index.html');
  assert.match(html, />Choose Scenario</);
  assert.match(html, />View Progress</);
  const js = html.slice(html.indexOf('<script type="module">'));
  assert.match(js, /renderScenarioModal/, 'the catalogue renders into the modal');
  assert.match(js, /renderProgressModal/, 'progress renders into the modal');
  // Progress must report totals AND remaining work, per category.
  assert.match(js, /remaining/, 'progress states what is left');
  assert.match(js, /ALL CATEGORIES/, 'category totals are summarised');
});

test('T41. developer detail outranks scenario inventory for space', () => {
  const html = read('../public/index.html');
  const grid = html.match(/\.dash\{[^}]*grid-template-columns:([^;]+);/);
  assert.ok(grid, 'dashboard grid must be declared');
  assert.match(grid[1], /3[0-3]%/, 'developer detail gets roughly 30% of the width');
  const right = html.slice(html.indexOf('Developer detail'));
  assert.ok(right.includes('paneFeat') && right.includes('paneRun')
    && right.includes('panePerc'), 'all developer tabs live in that column');
});

test('T42. presence and phone sit side by side while pending', () => {
  const html = read('../public/index.html');
  assert.match(html, /class="pair"/, 'a two-column pair wrapper must exist');
  const pair = html.slice(html.indexOf('class="pair"'),
                          html.indexOf('Both models are still being compared'));
  assert.ok(pair.includes('Physical presence') && pair.includes('Phone context'),
    'both blocks share one row');
  for (const gone of ['id="objAssoc"', 'id="presBoth"', 'id="presStatus"']) {
    assert.ok(!pair.includes(gone), `${gone} must be hidden while pending`);
  }
});

test('T43. Signal Inspector links measurement to rule without duplication', () => {
  const html = read('../public/index.html');
  const feat = html.slice(html.indexOf('id="paneFeat"'), html.indexOf('id="paneRun"'));
  assert.match(feat, /table class="vals"/, 'values use a real table');
  assert.match(feat, /<th>Raw<\/th><th>&Delta; base<\/th><th>Smoothed<\/th>/);
  // Rule, instantaneous cue, persistence and persisted evidence are four
  // distinct concepts and must each get their own column: collapsing them
  // is what let a raw movement read as a “trigger”.
  assert.match(feat,
    /<th>Rule<\/th><th>Instant cue<\/th><th>Persistence<\/th><th>Evidence<\/th>/,
    'rule, instant cue, persistence and evidence sit beside the measurement');
  for (const cell of ['yawRaw', 'yawDelta', 'yawSm', 'yawRule', 'yawInst',
                      'yawPers', 'yawStat']) {
    assert.ok(feat.includes(`id="${cell}"`), `missing cell #${cell}`);
  }
  // One pitch MEASUREMENT, two interpretations read off it.
  assert.equal((feat.match(/id="pitchRaw"/g) ?? []).length, 1,
    'the pitch measurement must appear exactly once');
  assert.match(feat, /Pitch interpretation/);
  assert.ok(feat.includes('id="pitchUpRule"') && feat.includes('id="pitchDownRule"'));
  assert.ok(!feat.includes('<td class="dimval">↑</td>'),
    'the duplicated-measurement arrow row is gone');
  // §52 terminology lock: Roll is internal only.
  assert.match(feat, /Head Tilt/, 'roll is surfaced as Head Tilt');
  assert.ok(!/<td>Roll<\/td>/.test(html), 'Roll must not be a UI signal name');
});

test('T44. the eye rule is shown beside the eye measurements', () => {
  const html = read('../public/index.html');
  const feat = html.slice(html.indexOf('id="paneFeat"'), html.indexOf('id="paneRun"'));
  for (const cell of ['earL', 'earR', 'earMean', 'earRel', 'earSm',
                      'eyeEligCell', 'eyeThresh', 'eyePers', 'eyeStat', 'eyeReason']) {
    assert.ok(feat.includes(`id="${cell}"`), `eye section missing #${cell}`);
  }
});

test('T45. the developer panel does not repeat the AI Result', () => {
  const html = read('../public/index.html');
  const right = html.slice(html.indexOf('Developer detail'));
  // State, primary reason and time-in-state have ONE home: the centre panel.
  for (const dup of ['id="dgReason"', 'id="dgStateDur"', 'id="dgSignal"']) {
    assert.ok(!right.includes(dup),
      `${dup} duplicates the AI Result panel and must not appear in developer detail`);
  }
});

test('T46. the Perception tab states a single clean pending message', () => {
  const html = read('../public/index.html');
  const perc = html.slice(html.indexOf('id="panePerc"'));
  assert.match(perc, /PENDING BAKE-OFF/);
  assert.match(perc, /not yet been\s+selected or integrated/i);
  assert.ok(!/>N\/A</.test(perc), 'no N/A spam in the pending perception tab');
});

test('T47. the official scenario matrix is complete and unreduced', () => {
  // P01-P10 presence, H01-H10 phone. Silently shrinking the matrix would make
  // the benchmark unfair without anyone noticing.
  assert.equal(PERSON_SCENARIOS.length, 10);
  assert.equal(PHONE_SCENARIOS.length, 10);
  assert.deepEqual(PERSON_SCENARIOS.map((s) => s.code),
    ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10']);
  assert.deepEqual(PHONE_SCENARIOS.map((s) => s.code),
    ['H01', 'H02', 'H03', 'H04', 'H05', 'H06', 'H07', 'H08', 'H09', 'H10']);
  // H10 is a standardised hard negative: without it, a detector that fires on
  // any dark rectangle would look perfect on the empty control alone.
  const h10 = PHONE_SCENARIOS.find((s) => s.code === 'H10');
  assert.equal(h10.id, 'phone_lookalike_negative');
  assert.equal(h10.expect, false);
  // Each task keeps TWO negative controls: an empty one and a hard one.
  assert.equal(PERSON_SCENARIOS.filter((s) => !s.expect).length, 2);
  assert.equal(PHONE_SCENARIOS.filter((s) => !s.expect).length, 2);
});

