/**
 * Telemetry source-of-truth tests (spec §22–§24, §55).
 *
 * These exist because of a specific, repeated class of defect: the UI showed
 * "Head-pose signal VALID" beside a dash for every angle, and the header showed
 * "State —" while the body showed FOKUS. The cause was never the AI — it was
 * TWO writers with a gap between them. The harness wrote a combined string into
 * element handles that had become detached proxies when the UI moved to
 * per-cell tables, so the real cells had no writer at all.
 *
 * Rather than assert on markup, these drive a real frame through the real
 * render path and read the resulting DOM back. A cosmetic patch cannot pass
 * them; only correct binding can.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { DebugHarness } from '../tools/debug/DebugHarness.js';

const readPage = () =>
  readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

const IDS = [
  'video', 'status', 'face', 'poseValid',
  'yawRaw', 'yawDelta', 'yawSm',
  'pitchRaw', 'pitchDelta', 'pitchSm',
  'rollRaw', 'rollDelta', 'rollSm',
  'earL', 'earR', 'earMean', 'earRel', 'earSm',
  'missing', 'faceMissingRow',
  'state', 'reason', 'stateDur', 'stateValid', 'eyeElig',
  'fps', 'inference', 'infP50', 'infP95', 'delegate',
  'calStatus', 'calDetail', 'calSamples',
  'hState', 'hCal', 'hPerf',
  'evYaw', 'evPitchUp', 'evEye', 'evPitchDown', 'evRoll',
  'yawBar', 'pitchUpBar', 'eyeBar', 'pitchDownBar', 'rollBar',
];

/** Minimal element stubs; enough for the render path to write into. */
function makeEls() {
  const els = {};
  for (const id of IDS) {
    els[id] = { id, textContent: '', className: '', style: {}, hidden: false };
  }
  return els;
}

const BASELINE = {
  status: 'VALID',
  baseline: { yaw: -2.5, pitch: -6.8, roll: 0.4, ear: 0.412, sampleCount: 149 },
  validSamples: 149, totalFrames: 150,
};

/** A realistic calibrated frame: face present, pose valid, eyes open. */
const frame = (over = {}) => ({
  timestampMs: 1000,
  measurement: {
    facePresent: true, poseValid: true, poseInvalidReason: null,
    yawRaw: 12.4, pitchRaw: -3.1, rollRaw: 1.9,
    earLeft: 0.401, earRight: 0.395, earMean: 0.398,
    ...(over.measurement ?? {}),
  },
  calibrated: {
    yawDelta: 14.9, pitchDelta: 3.7, rollDelta: 1.5, earRelative: 0.966,
    ...(over.calibrated ?? {}),
  },
  temporal: {
    yawSmoothed: 13.8, pitchSmoothed: 3.2, rollSmoothed: 1.4,
    earSmoothed: 0.964, faceMissingMs: 0, facePresentMs: 8000,
    ...(over.temporal ?? {}),
  },
  evidence: {
    active: { yawStrong: false }, accumulated: { yawStrong: 0 }, eyeEligible: true,
    ...(over.evidence ?? {}),
  },
  classification: {
    state: 'FOKUS', primaryReason: 'NONE', stateDurationMs: 8000, holding: false,
    ...(over.classification ?? {}),
  },
  performance: { fps: 29.4, inferenceMs: 11.2, ...(over.performance ?? {}) },
  validity: { stateSignalValid: true, ...(over.validity ?? {}) },
});

/** Harness wired to stub elements, with a controllable calibration snapshot. */
function harnessWith(cal = BASELINE) {
  const els = makeEls();
  globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
  const h = new DebugHarness({ FilesetResolver: {}, FaceLandmarker: {} }, els);
  h.ai.getCalibrationSnapshot = () => cal;
  return { h, els };
}

// ── §23: valid pose + valid calibration must yield numbers ──────────────
test('B1. a valid head pose produces numeric Yaw / Pitch / Head Tilt', () => {
  const { h, els } = harnessWith();
  h._render(frame());
  // The exact defect: poseValid true while every angle read a dash.
  assert.equal(els.poseValid.textContent, 'VALID');
  for (const [id, want] of [
    ['yawRaw', '12.4°'], ['yawDelta', '14.9°'], ['yawSm', '13.8°'],
    ['pitchRaw', '-3.1°'], ['pitchDelta', '3.7°'], ['pitchSm', '3.2°'],
    ['rollRaw', '1.9°'], ['rollDelta', '1.5°'], ['rollSm', '1.4°'],
  ]) {
    assert.equal(els[id].textContent, want, `${id} must be numeric`);
  }
});

test('B2. EAR measurements are numeric when a face is present', () => {
  const { h, els } = harnessWith();
  h._render(frame());
  assert.equal(els.earL.textContent, '0.401');
  assert.equal(els.earR.textContent, '0.395');
  assert.equal(els.earMean.textContent, '0.398');
  assert.equal(els.earRel.textContent, '0.966');
  assert.equal(els.earSm.textContent, '0.964');
  // If EAR is measurable, the eye decision must be populated too (§23).
  assert.equal(els.eyeElig.textContent, 'eligible');
});

// ── §23: header and body cannot disagree ────────────────────────────────
test('B3. header calibration matches the Calibration card', () => {
  const { h, els } = harnessWith();
  h._render(frame());
  assert.equal(els.calStatus.textContent, 'VALID');
  assert.equal(els.hCal.textContent, els.calStatus.textContent,
    'header and card read the same calibration snapshot');
  assert.equal(els.calSamples.textContent, '149');
});

test('B4. header state matches the AI Result panel', () => {
  const { h, els } = harnessWith();
  h._render(frame({ classification: { state: 'TERALIH', primaryReason: 'YAW' } }));
  assert.equal(els.state.textContent, 'TERALIH');
  assert.equal(els.hState.textContent, els.state.textContent,
    'header and AI Result read the same frame');
});

test('B5. header performance comes from the same frame as the Runtime tab', () => {
  const { h, els } = harnessWith();
  h._render(frame());
  assert.match(els.fps.textContent, /29\.4/);
  assert.match(els.hPerf.textContent, /29 fps/);
  assert.match(els.hPerf.textContent, /11\.2 ms/);
});

// ── §4: explicit, state-aware placeholders ──────────────────────────────
test('B6. an uncalibrated session says so instead of showing a dash', () => {
  const { h, els } = harnessWith({
    status: 'NONE', baseline: null, validSamples: 0, totalFrames: 0,
  });
  h._render(frame());
  // Raw is measurable without a baseline; deltas are not.
  assert.equal(els.yawRaw.textContent, '12.4°', 'raw needs no baseline');
  assert.equal(els.yawDelta.textContent, 'Requires calibration');
  assert.equal(els.earRel.textContent, 'Requires calibration');
  assert.equal(els.calSamples.textContent, 'Not started');
  assert.equal(els.hCal.textContent, 'NONE');
});

test('B7. a missing face is stated explicitly, not left blank', () => {
  const { h, els } = harnessWith();
  h._render(frame({
    measurement: { facePresent: false, poseValid: false, poseInvalidReason: 'NO_FACE' },
    temporal: { faceMissingMs: 640 },
  }));
  assert.equal(els.yawRaw.textContent, 'No face');
  assert.equal(els.earMean.textContent, 'No face');
});

test('B8. an invalid pose signal is distinguished from a missing face', () => {
  const { h, els } = harnessWith();
  h._render(frame({
    measurement: { facePresent: true, poseValid: false, poseInvalidReason: 'LOW_CONF' },
  }));
  // The face IS there; only the pose extraction failed. Saying "No face" here
  // would send a developer chasing the wrong problem.
  assert.equal(els.yawRaw.textContent, 'Signal invalid');
  assert.equal(els.earMean.textContent, '0.398', 'EAR is still measurable');
});

test('B9. a value that should exist but does not reads Unavailable', () => {
  const { h, els } = harnessWith();
  // Pose reports valid but the angle is NaN — a genuine extraction failure.
  h._render(frame({ measurement: { yawRaw: NaN } }));
  assert.equal(els.yawRaw.textContent, 'Unavailable',
    'a broken value must not silently render as a dash');
});

// ── §13/§19: conditional rows ───────────────────────────────────────────
test('B10. the face-missing row is hidden while the face is present', () => {
  const { h, els } = harnessWith();
  h._render(frame());
  assert.equal(els.faceMissingRow.style.display, 'none');
  h._render(frame({ temporal: { faceMissingMs: 800 } }));
  assert.equal(els.faceMissingRow.style.display, '');
});

// ── §20: latency percentiles are real, not invented ─────────────────────
test('B11. p50 / p95 collect before reporting a number', () => {
  const { h } = harnessWith();
  h.running = true;
  h._render(frame());
  // One sample is not a percentile.
  assert.equal(h.buildViewModel(frame()).runtime.p50, 'Collecting…');

  for (let i = 0; i < 40; i++) {
    h._render(frame({ performance: { fps: 30, inferenceMs: 10 + (i % 5) } }));
  }
  const vm = h.buildViewModel(frame());
  assert.match(vm.runtime.p50, /^\d+\.\d ms$/);
  assert.match(vm.runtime.p95, /^\d+\.\d ms$/);
  const p50 = parseFloat(vm.runtime.p50);
  const p95 = parseFloat(vm.runtime.p95);
  assert.ok(p95 >= p50, 'p95 must not fall below p50');
  assert.ok(p50 >= 10 && p95 <= 14, 'percentiles reflect the fed values');
});

test('B12. the latency window stays bounded', () => {
  const { h } = harnessWith();
  for (let i = 0; i < 400; i++) {
    h._render(frame({ performance: { fps: 30, inferenceMs: 12 } }));
  }
  assert.ok(h.latency.length <= 240,
    `latency buffer must not grow without bound, got ${h.latency.length}`);
});

// ── §22: one authoritative source, no stale duplicate stores ────────────
test('B13. every head-pose cell is bound to a real element, not a proxy', () => {
  const html = readPage();
  const js = html.slice(html.indexOf('<script type="module">'));
  // The regression was silent because writes landed on detached proxies.
  for (const cell of ['yawRaw', 'yawDelta', 'yawSm', 'pitchRaw', 'pitchDelta',
                      'pitchSm', 'rollRaw', 'rollDelta', 'rollSm']) {
    assert.match(js, new RegExp(`${cell}: id\\('${cell}'\\)`),
      `${cell} must be wired to a real DOM node`);
  }
  assert.ok(!/yaw: shim\.yaw/.test(js),
    'head pose must not be routed to a detached proxy');
});


