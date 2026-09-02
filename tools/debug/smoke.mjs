/**
 * Debug smoke test — verifies the harness wiring without a browser.
 *
 * Loads DebugHarness through the real module graph with minimal stubs for the
 * browser globals it needs, then drives a full session through the public API.
 * Catches import-path breakage and AI<->logger wiring regressions that unit
 * tests on the core alone would miss.
 *
 * Run: npm run smoke
 */
globalThis.performance ??= { now: () => Date.now() };
globalThis.document = { createElement: () => ({ click() {}, style: {} }) };
globalThis.Blob = class { constructor(p) { this.parts = p; } };
globalThis.URL.createObjectURL ??= () => 'blob:stub';
globalThis.URL.revokeObjectURL ??= () => {};

const { DebugHarness } = await import('./DebugHarness.js');
const { CONFIG, ScenarioTruth, AIState } = await import('../../src/ai/index.js');

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (c, m) => (c ? console.log('  ok  ', m) : fail(m));

console.log('debug smoke test\n');

// Minimal DOM element map.
const el = () => ({ textContent: '', className: '', style: {} });
const els = {};
for (const k of ['video','status','face','poseValid','yaw','pitch','roll','earL','earR',
  'earMean','earRel','earSm','missing','presentMs','state','reason','stateDur',
  'evYaw','evPitchUp','evEye','evPitchDown','evRoll','evAbsence',
  'fps','inference','frames','calStatus','calDetail',
  'yawBar','pitchUpBar','eyeBar','pitchDownBar','rollBar','faceBar',
  'rangeYaw','rangePitch','rangeRoll','rangeEar','anomalies','truthActive']) els[k] = el();

const harness = new DebugHarness({ FilesetResolver: {}, FaceLandmarker: {} }, els);
ok(harness.ai, 'harness constructs a HachikoAI via the public API');
ok(harness.logger, 'harness owns its own TelemetryLogger');
ok(typeof harness.ai.getTelemetry === 'undefined', 'AI core exposes no storage');
ok(harness.engine.assetPaths.modelAssetPath === CONFIG.landmarker.modelAssetPath,
   'asset paths resolve from config by default');

// Drive a session directly through the AI (no camera involved).
const F = 1000 / 30;
const m = (o = {}) => ({
  facePresent: true, poseValid: true, poseInvalidReason: 'NONE',
  yawRaw: 0, pitchRaw: 0, rollRaw: 0,
  earLeft: 0.3, earRight: 0.3, earMean: 0.3, ...o,
});
let t = 0;
harness.ai.startCalibration(t);
for (; t < 5100; t += F) harness.ai.processFrame(m(), t, 3);
ok(harness.ai.calibration.isValid(), 'calibration completes');

harness.setScenarioTruth(ScenarioTruth.READ_BOOK);
for (const e = t + 12000; t < e; t += F) harness.ai.processFrame(m({ pitchRaw: -45 }), t, 3);
ok(harness.ai.stateEngine.state === AIState.FOKUS, 'READ_BOOK stays FOKUS (support-only)');

harness.setScenarioTruth(ScenarioTruth.LOOK_LEFT_LONG);
for (const e = t + 7000; t < e; t += F) harness.ai.processFrame(m({ yawRaw: 45 }), t, 3);
ok(harness.ai.stateEngine.state === AIState.TERALIH, 'sustained yaw becomes TERALIH');

// Logger received everything through onFrame.
ok(harness.logger.length > 500, `logger captured frames via onFrame (${harness.logger.length})`);
const csv = harness.logger.toCSV().split('\n');
ok(csv[0].includes('d_state') && csv[0].includes('g_manualScenarioTruth'),
   'CSV keeps prediction and ground truth in separate columns');
ok(csv.length - 1 === harness.logger.length, 'CSV row count matches frame count');

const a = harness.logger.analyze();
ok(a.groundTruth.READ_BOOK && a.groundTruth.LOOK_LEFT_LONG, 'analysis buckets ground truth');
ok(a.groundTruth.READ_BOOK.states.FOKUS > 0, 'READ_BOOK recorded as FOKUS');
ok(a.transitionCount >= 1, 'transitions counted');

// Rendering path must not throw on a real frame.
try {
  harness._render(harness.ai.processFrame(m(), t, 3));
  ok(els.state.textContent.length > 0, '_render populates the DOM map');
} catch (err) { fail('_render threw: ' + err.message); }

// ── Debug UI observability (v0.2.1 UI change) ───────────────────────────
// Support bars must fill during head-down / tilt, while staying muted and
// leaving the state alone.
let t2 = t + 5000;
harness.ai.reset();
harness.ai.startCalibration(t2);
for (const e = t2 + 5100; t2 < e; t2 += F) harness.ai.processFrame(m(), t2, 3);
let last;
for (const e = t2 + 12000; t2 < e; t2 += F) {
  last = harness.ai.processFrame(m({ pitchRaw: -45, rollRaw: 35 }), t2, 3);
}
harness._render(last);
ok(parseFloat(els.pitchDownBar.style.width) >= 100, 'pitchDown bar fills');
ok(parseFloat(els.rollBar.style.width) >= 100, 'roll bar fills');
ok(els.pitchDownBar.className.includes('support'), 'pitchDown bar stays muted (support)');
ok(els.rollBar.className.includes('support'), 'roll bar stays muted (support)');
ok(last.classification.state === AIState.FOKUS, 'filled support bars do NOT change state');

// Presence/absence section tracks its own signal.
harness._render(harness.ai.processFrame(m(), t2, 3));
ok(els.evAbsence.textContent === 'present', 'absence reads "present" with a face');
for (const e = t2 + 5000; t2 < e; t2 += F) {
  last = harness.ai.processFrame({
    facePresent: false, poseValid: false, poseInvalidReason: 'NO_FACE',
    yawRaw: null, pitchRaw: null, rollRaw: null,
    earLeft: null, earRight: null, earMean: null,
  }, t2, 3);
}
harness._render(last);
ok(els.evAbsence.textContent === 'ABSENT', 'absence reads ABSENT after sustained loss');
ok(parseFloat(els.faceBar.style.width) >= 100, 'absence bar fills');
ok(els.presentMs.textContent.endsWith('ms'), 'face-present duration rendered');

// Detach isolates the logger.
harness.logger.detach();
const before = harness.logger.length;
harness.ai.processFrame(m(), t + 1000, 3);
ok(harness.logger.length === before, 'detach stops recording');

console.log(process.exitCode ? '\nSMOKE TEST FAILED' : '\nsmoke test passed');
