/**
 * Debug smoke test — verifies harness wiring without a browser.
 *
 * Loads DebugHarness through the real module graph with minimal stubs for the
 * browser globals it needs, then drives a full bounded trial through the public
 * API. Catches import-path breakage and, above all, verifies the experiment
 * boundary: camera-on must not record, and only the trial window is stored.
 *
 * Run: npm run smoke
 */
globalThis.performance ??= { now: () => Date.now() };
globalThis.document = { createElement: () => ({ click() {}, style: {} }) };
globalThis.Blob = class { constructor(p) { this.parts = p; } };
globalThis.URL.createObjectURL ??= () => 'blob:stub';
globalThis.URL.revokeObjectURL ??= () => {};
globalThis.navigator ??= { userAgent: 'node-smoke', hardwareConcurrency: 8 };
globalThis.window ??= { innerWidth: 1440, innerHeight: 900 };
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => {};

const { DebugHarness } = await import('./DebugHarness.js');
const { CONFIG, AIState } = await import('../../src/ai/index.js');
const { getScenario } = await import('./scenarios.js');
const { TrialState } = await import('../shared/TrialController.js');
const { toSample } = await import('./DebugSession.js');

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (c, m) => (c ? console.log('  ok  ', m) : fail(m));

console.log('debug smoke test\n');

const el = () => ({ textContent: '', className: '', style: {}, innerHTML: '' });
const els = {};
for (const k of ['video', 'status', 'face', 'poseValid', 'yaw', 'pitch', 'roll',
  'earL', 'earR', 'earMean', 'earRel', 'earSm', 'missing', 'presentMs',
  'state', 'reason', 'stateDur', 'evYaw', 'evPitchUp', 'evEye', 'evPitchDown',
  'evRoll', 'evAbsence', 'eyeElig', 'objPerson', 'objPrimary', 'objAssoc',
  'presStatus', 'presBoth', 'presenceModel', 'phoneModel', 'stateValid',
  'objPhone', 'phoneEvent', 'objInference', 'rawCount', 'acceptedCount',
  'inferCount', 'nameAvail', 'videoDims', 'rejects', 'rawTop', 'fps',
  'inference', 'frames', 'calStatus', 'calDetail', 'yawBar', 'pitchUpBar',
  'eyeBar', 'pitchDownBar', 'rollBar', 'faceBar', 'rangeYaw', 'rangePitch',
  'rangeRoll', 'rangeEar', 'anomalies', 'truthActive', 'recState']) els[k] = el();

const harness = new DebugHarness({ FilesetResolver: {}, FaceLandmarker: {} }, els);
ok(harness.ai, 'harness constructs a HachikoAI via the public API');
ok(harness.session, 'harness owns a DebugSession');
ok(harness.trials, 'harness owns a TrialController');

// ── Perception must be pending, not provisional ────────────────────────
ok(harness.objectEngine === null,
   'no provisional object detector is constructed while the Bake-off is open');
ok(harness.perceptionPending === true, 'perception is flagged PENDING');

// ── Camera on must NOT record ──────────────────────────────────────────
ok(harness.trials.state === TrialState.CAMERA_OFF, 'starts CAMERA_OFF');
harness.trials.cameraStarted();
harness.running = true;
ok(harness.trials.state === TrialState.CAMERA_READY, 'camera on -> CAMERA_READY');
ok(!harness.trials.isRecording(), 'camera on is NOT recording');

const F = 1000 / 30;
const B = { yaw: -2.8, pitchCanon: -2.3, ear: 0.394 };
const m = (o = {}) => ({
  facePresent: true, poseValid: true, poseInvalidReason: 'NONE',
  yawRaw: B.yaw, pitchRaw: B.pitchCanon, rollRaw: 0,
  earLeft: B.ear, earRight: B.ear, earMean: B.ear, ...o,
});

let t = 0;
harness.ai.startCalibration(t);
for (; t < 5100; t += F) harness.ai.processFrame(m(), t);
ok(harness.ai.calibration.isValid(), 'calibration completes');
harness.session.calibrationSnapshot = harness.ai.getCalibrationSnapshot();

// 3 s of live preview while idle — must store nothing.
for (const e = t + 3000; t < e; t += F) {
  const f = harness.ai.processFrame(m(), t);
  harness.trials.offerSample({ ...toSample(f), timestampMs: t });
}
ok(harness.trials.samples.length === 0, 'idle preview stores no experiment data');
ok(harness.session.trials.length === 0, 'no trials exist before START TRIAL');

// ── One bounded trial ──────────────────────────────────────────────────
const sc = getScenario('LOOK_LEFT_LONG');
const sel = harness.selectScenario(sc.id);
ok(sel.ok, 'scenario selected');
ok(!harness.trials.isRecording(), 'selecting a scenario does NOT start recording');

const ref = harness.session.nextTrialRef(sc.id);
ok(ref.repetition === 1, 'first repetition is 1');
harness.trials.startTrial(t, ref);

let countdownAccepted = 0;
for (const e = t + sc.countdownMs; t < e; t += F) {
  harness.trials.tick(t);
  const f = harness.ai.processFrame(m({ yawRaw: B.yaw + 45 }), t);
  if (harness.trials.offerSample({ ...toSample(f), timestampMs: t })) countdownAccepted++;
}
ok(countdownAccepted === 0, 'countdown frames are NOT recorded');

harness.trials.tick(t);
let completed = null;
for (const e = t + sc.recordingDurationMs + 500; t < e; t += F) {
  const r = harness.trials.tick(t);
  const f = harness.ai.processFrame(m({ yawRaw: B.yaw + 45 }), t);
  harness.trials.offerSample({ ...toSample(f), timestampMs: t });
  if (r.trial) { completed = r.trial; break; }
}
ok(completed !== null, 'trial auto-stops at its configured duration');
ok(harness.session.trials.length === 1, 'the trial was stored');

const rec = harness.session.trials[0];
ok(rec.sampleCount > 50, `window captured ${rec.sampleCount} samples`);
ok(rec.samples.every((s) => s.timestampMs >= rec.recordingStartedAt
   && s.timestampMs <= rec.recordingEndedAt), 'every sample is inside the window');
ok(rec.summary.triggerOccurred, 'sustained yaw triggered inside the window');
ok(rec.summary.observedFinalState === AIState.TERALIH,
   `final state ${rec.summary.observedFinalState}`);

// Post-trial frames must not leak.
const before = rec.sampleCount;
for (let i = 0; i < 30; i++, t += F) {
  const f = harness.ai.processFrame(m(), t);
  harness.trials.offerSample({ ...toSample(f), timestampMs: t });
}
ok(harness.session.trials[0].sampleCount === before, 'post-trial frames do not leak');

// ── Repetition + invalidation ──────────────────────────────────────────
ok(harness.session.repetitionCount(sc.id) === 1, 'repetition count is 1');
ok(harness.session.nextTrialRef(sc.id).repetition === 2, 'next repetition is 2');
const deleted = harness.deleteLastTrial();
ok(deleted && deleted.trialId === rec.trialId, 'Delete Last Trial removes the newest trial');
ok(harness.session.trials.length === 0, 'the trial is REMOVED, not flagged');
ok(harness.session.discarded === undefined, 'no tombstone list is retained');
ok(deleted.samples === null, 'linked telemetry is dropped with it');
ok(harness.session.repetitionCount(sc.id) === 0, 'progress rolls back');

// ── Export ─────────────────────────────────────────────────────────────
const bundle = harness.session.buildExportBundle({ userAgent: 'node-smoke' });
// Look files up by NAME, never by index: positional access silently breaks the
// moment the bundle order changes.
const fileNamed = (n) => bundle.files.find((f) => f.name === n);
ok(bundle.files.length === 3, 'export produces exactly three files');
ok(!!fileNamed('debug_results.json'), 'results.json present');
ok(!!fileNamed('debug_trials.csv'), 'trials CSV present');
ok(!!fileNamed('debug_telemetry.csv'), 'telemetry CSV present');
ok(/\.zip$/.test(bundle.archiveName), 'delivered as one archive');

const doc = JSON.parse(fileNamed('debug_results.json').content);
ok(doc.perception.presenceModel === 'PENDING BAKE-OFF', 'JSON declares perception PENDING');
ok(Array.isArray(doc.scenarios) && doc.scenarios.length > 0, 'JSON carries the protocol');
ok(!!doc.config.state, 'JSON carries the thresholds');
// The perception columns exist on every trial row; this session deleted its
// only trial, so assert the header carries them rather than a row value.
ok(/perception_presence_model/.test(fileNamed('debug_trials.csv').content),
   'trials CSV records which perception model was active');

// The deleted trial must leave no trace in any artefact.
for (const f of bundle.files) {
  ok(!f.content.includes(rec.trialId), `${f.name} excludes the deleted trial`);
}
const trialRows = fileNamed('debug_trials.csv').content
  .split(String.fromCharCode(10)).filter(Boolean);
ok(trialRows.length - 1 === 0, 'no valid trials remain after the delete');
ok(doc.trials.length === 0, 'the JSON has no trial entries either');

for (const f of bundle.files) {
  ok(!/data:image|blob:|ImageData|base64/.test(f.content), `${f.name} has no imagery`);
}

console.log(process.exitCode ? '\nSMOKE TEST FAILED' : '\nsmoke test passed');
