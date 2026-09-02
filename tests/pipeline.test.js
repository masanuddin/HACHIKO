/**
 * Unit tests — calibration, smoothing, persistence, pose validity.
 * These run entirely without a webcam by feeding synthetic measurements.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  withOverrides, CONFIG,
  CalibrationEngine, FeatureSmoother,
  PersistenceTimer, FaceMissingTracker,
  HeadPoseExtractor, EyeFeatureExtractor,
  CalibrationStatus, PoseInvalidReason,
} from '../src/ai/index.js';

const close = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);

/** Synthetic valid measurement. */
function measurement(over = {}) {
  return {
    facePresent: true, poseValid: true, poseInvalidReason: PoseInvalidReason.NONE,
    yawRaw: 0, pitchRaw: 0, rollRaw: 0,
    earLeft: 0.30, earRight: 0.30, earMean: 0.30,
    ...over,
  };
}

// ── Calibration ─────────────────────────────────────────────────────────
test('calibration produces a median baseline from valid frames', () => {
  const cal = new CalibrationEngine(CONFIG);
  cal.start(0);
  // 100 frames over 5 s, yaw wobbling around 5 deg, EAR around 0.30.
  for (let i = 0; i < 100; i++) {
    const t = i * 50;
    cal.update(measurement({
      yawRaw: 5 + (i % 2 === 0 ? 1 : -1),
      pitchRaw: -3,
      earMean: 0.30 + (i % 2 === 0 ? 0.01 : -0.01),
    }), t);
  }
  cal.update(measurement(), 5000);
  assert.equal(cal.status, CalibrationStatus.VALID);
  close(cal.baseline.yaw, 5, 1.01);
  close(cal.baseline.pitch, -3, 1e-6);
  close(cal.baseline.ear, 0.30, 0.011);
});

test('calibration ignores invalid frames rather than counting them as zero', () => {
  const cal = new CalibrationEngine(CONFIG);
  cal.start(0);
  for (let i = 0; i < 100; i++) {
    // Every 3rd frame has no face; a naive implementation averaging zeros
    // would drag the yaw baseline from 20 toward 13.
    const bad = i % 3 === 0;
    cal.update(
      bad
        ? measurement({ facePresent: false, poseValid: false, yawRaw: null, pitchRaw: null, earMean: null })
        : measurement({ yawRaw: 20, pitchRaw: 0 }),
      i * 50
    );
  }
  cal.update(measurement({ yawRaw: 20 }), 5000);
  assert.equal(cal.status, CalibrationStatus.VALID);
  close(cal.baseline.yaw, 20, 1e-6);
});

test('calibration fails when too few valid samples arrive', () => {
  const cal = new CalibrationEngine(CONFIG);
  cal.start(0);
  for (let i = 0; i < 10; i++) cal.update(measurement(), i * 50);
  cal.update(measurement({ facePresent: false, poseValid: false }), 5000);
  assert.equal(cal.status, CalibrationStatus.FAILED);
  assert.match(cal.failureReason, /insufficient valid samples/);
  assert.equal(cal.baseline, null);
});

test('calibration fails when the head was moving (unstable baseline)', () => {
  const cal = new CalibrationEngine(CONFIG);
  cal.start(0);
  for (let i = 0; i < 100; i++) {
    cal.update(measurement({ yawRaw: -50 + i }), i * 50);  // sweeping -50..50
  }
  cal.update(measurement(), 5000);
  assert.equal(cal.status, CalibrationStatus.FAILED);
  assert.match(cal.failureReason, /yaw unstable/);
});

test('calibration fails when eyes were closed throughout', () => {
  const cal = new CalibrationEngine(CONFIG);
  cal.start(0);
  for (let i = 0; i < 100; i++) cal.update(measurement({ earMean: 0.05 }), i * 50);
  cal.update(measurement({ earMean: 0.05 }), 5000);
  assert.equal(cal.status, CalibrationStatus.FAILED);
  assert.match(cal.failureReason, /EAR baseline too low/);
});

test('applyTo returns nulls when uncalibrated, never fabricated zeros', () => {
  const cal = new CalibrationEngine(CONFIG);
  const out = cal.applyTo(measurement({ yawRaw: 40 }));
  assert.equal(out.yawDelta, null);
  assert.equal(out.pitchDelta, null);
  assert.equal(out.earRelative, null);
});

test('applyTo expresses measurements relative to baseline', () => {
  const cal = new CalibrationEngine(CONFIG);
  cal.start(0);
  for (let i = 0; i < 100; i++) {
    cal.update(measurement({ yawRaw: 10, pitchRaw: -5, earMean: 0.30 }), i * 50);
  }
  cal.update(measurement({ yawRaw: 10 }), 5000);
  const out = cal.applyTo(measurement({ yawRaw: 35, pitchRaw: -5, earMean: 0.15 }));
  close(out.yawDelta, 25);          // 35 - 10
  close(out.pitchDelta, 0);         // -5 - (-5)
  close(out.earRelative, 0.5);      // 0.15 / 0.30
});

// ── Smoothing ───────────────────────────────────────────────────────────
test('smoother tracks a step input without overshooting', () => {
  const s = new FeatureSmoother(CONFIG);
  let out;
  for (let i = 0; i < 60; i++) {
    out = s.update({ yawDelta: 40, pitchDelta: null, earRelative: null }, i * 33.3);
  }
  assert.ok(out.yawSmoothed > 39 && out.yawSmoothed <= 40.0001,
    `converged to ${out.yawSmoothed}`);
});

test('smoother holds its value through a momentarily invalid frame', () => {
  const s = new FeatureSmoother(CONFIG);
  for (let i = 0; i < 30; i++) s.update({ yawDelta: 30, pitchDelta: null, earRelative: null }, i * 33.3);
  const before = s.yawSmoothed;
  const out = s.update({ yawDelta: null, pitchDelta: null, earRelative: null }, 30 * 33.3);
  close(out.yawSmoothed, before);  // held, not reset to null/0
});

test('smoother restarts after a long gap (tab throttled / machine slept)', () => {
  const s = new FeatureSmoother(CONFIG);
  for (let i = 0; i < 30; i++) s.update({ yawDelta: 40, pitchDelta: null, earRelative: null }, i * 33.3);
  const out = s.update({ yawDelta: 0, pitchDelta: null, earRelative: null }, 60000);
  close(out.yawSmoothed, 0);   // reseeded rather than blending a stale value
});

// ── Persistence timer ───────────────────────────────────────────────────
test('PersistenceTimer only fires after the required duration', () => {
  const timer = new PersistenceTimer(1500, 300);
  assert.equal(timer.update(true, 0), false);
  assert.equal(timer.update(true, 1000), false);
  assert.equal(timer.update(true, 1499), false);
  assert.equal(timer.update(true, 1500), true);
});

test('PersistenceTimer forgives a short dropout (landmark jitter)', () => {
  const timer = new PersistenceTimer(1500, 300);
  timer.update(true, 0);
  timer.update(true, 500);
  timer.update(false, 600);   // 100 ms blip, within tolerance
  timer.update(true, 700);
  // Accumulation continued from t=0 rather than restarting.
  assert.equal(timer.update(true, 1500), true);
});

test('PersistenceTimer resets after a long dropout', () => {
  const timer = new PersistenceTimer(1500, 300);
  timer.update(true, 0);
  timer.update(true, 1000);
  timer.update(false, 1400);  // 400 ms gap > 300 ms tolerance
  assert.equal(timer.isSatisfied(), false);
  timer.update(true, 1500);
  assert.equal(timer.update(true, 2000), false, 'clock restarted at 1500');
  assert.equal(timer.update(true, 3000), true);
});

// ── Face missing tracker ────────────────────────────────────────────────
test('a single missing frame NEVER counts as absent', () => {
  const tracker = new FaceMissingTracker(2000, 500);
  for (let i = 0; i < 30; i++) tracker.update(true, i * 33.3);
  const r = tracker.update(false, 30 * 33.3);   // exactly one dropped frame
  assert.equal(r.absent, false);
  assert.ok(r.faceMissingMs < 100, `accumulated only ${r.faceMissingMs} ms`);
});

test('sustained absence becomes absent only after FACE_MISSING_ENTER_MS', () => {
  const tracker = new FaceMissingTracker(2000, 500);
  let t = 0;
  for (let i = 0; i < 30; i++, t += 33.3) tracker.update(true, t);
  let r;
  while (t < 3000) { r = tracker.update(false, t); t += 33.3; }
  assert.equal(r.absent, true);
  assert.ok(r.faceMissingMs >= 2000);
});

test('absence requires sustained presence to clear (not one lucky frame)', () => {
  const tracker = new FaceMissingTracker(2000, 500);
  let t = 0;
  while (t < 3000) { tracker.update(false, t); t += 33.3; }
  assert.equal(tracker.isAbsent(), true);
  // One detected frame must not immediately clear it.
  tracker.update(true, t); t += 33.3;
  assert.equal(tracker.isAbsent(), true);
  // Sustained presence does.
  const end = t + 600;
  while (t < end) { tracker.update(true, t); t += 33.3; }
  assert.equal(tracker.isAbsent(), false);
});

test('face tracker ignores absurd frame gaps (suspended tab)', () => {
  const tracker = new FaceMissingTracker(2000, 500);
  tracker.update(true, 0);
  const r = tracker.update(false, 60000);   // 60 s jump
  assert.equal(r.absent, false, 'must not credit a suspended tab as absence');
  assert.equal(r.faceMissingMs, 0);
});

// ── Head pose validity ──────────────────────────────────────────────────
const D = Math.PI / 180;
function mul(A, B) { return A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0))); }
const Ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const Rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const Rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const compose = (y, p, r) => mul(mul(Ry(y * D), Rx(p * D)), Rz(r * D));

/** Pack a 3x3 rotation into MediaPipe's column-major 4x4 MatrixData. */
function toMatrixData(R) {
  return {
    rows: 4, columns: 4,
    data: [
      R[0][0], R[1][0], R[2][0], 0,
      R[0][1], R[1][1], R[2][1], 0,
      R[0][2], R[1][2], R[2][2], 0,
      0, 0, 0, 1,
    ],
  };
}

test('HeadPoseExtractor recovers angles from a MediaPipe-shaped matrix', () => {
  const ex = new HeadPoseExtractor(CONFIG);
  const out = ex.extract(toMatrixData(compose(20, -12, 6)));
  assert.equal(out.poseValid, true);
  close(out.yawRaw, 20, 1e-6);
  // Pitch is CANONICALIZED here (config.headPose.invertPitch), so a device
  // reading of -12 becomes canonical +12 = looking UP. Real Gate-1 evidence
  // showed this rig reports pitch with the opposite sign to the canonical
  // convention. Yaw and roll pass through unchanged.
  close(out.pitchRaw, 12, 1e-6);
  close(out.rollRaw, 6, 1e-6);
});

test('invalid pose is NEVER coerced to 0 degrees', () => {
  // The exact Python-harness defect: solvePnP failure returned (0.0, 0.0),
  // indistinguishable from a subject looking straight ahead.
  const ex = new HeadPoseExtractor(CONFIG);
  for (const bad of [null, undefined, { data: [] }, { data: new Array(16).fill(NaN) }]) {
    const out = ex.extract(bad);
    assert.equal(out.poseValid, false);
    assert.equal(out.yawRaw, null, 'must be null, not 0');
    assert.equal(out.pitchRaw, null);
    assert.equal(out.rollRaw, null);
    assert.notEqual(out.poseInvalidReason, PoseInvalidReason.NONE);
  }
});

test('degenerate (non-rotation) matrices are rejected', () => {
  const ex = new HeadPoseExtractor(CONFIG);
  const scaled = { rows: 4, columns: 4, data: [2,0,0,0, 0,2,0,0, 0,0,2,0, 0,0,0,1] };
  const out = ex.extract(scaled);
  assert.equal(out.poseValid, false);
  assert.equal(out.poseInvalidReason, PoseInvalidReason.DEGENERATE_MATRIX);
  assert.equal(out.yawRaw, null);
});

test('implausible angles are rejected rather than reported', () => {
  const cfg = withOverrides({ headPose: { maxPlausibleYawDeg: 30 } });
  const ex = new HeadPoseExtractor(cfg);
  const out = ex.extract(toMatrixData(compose(70, 0, 0)));
  assert.equal(out.poseValid, false);
  assert.equal(out.poseInvalidReason, PoseInvalidReason.IMPLAUSIBLE_ANGLE);
  assert.equal(out.yawRaw, null);
});

// ── Eye features ────────────────────────────────────────────────────────
/** Landmark array with both eyes at a given opening ratio. */
function landmarksWithEyes(openness) {
  const lm = new Array(468).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  const place = (indices) => {
    const [p1, p2, p3, p4, p5, p6] = indices;
    const w = 0.06, h = w * openness;
    lm[p1] = { x: 0.40, y: 0.50 };
    lm[p2] = { x: 0.40 + w * 0.3, y: 0.50 - h / 2 };
    lm[p3] = { x: 0.40 + w * 0.7, y: 0.50 - h / 2 };
    lm[p4] = { x: 0.40 + w, y: 0.50 };
    lm[p5] = { x: 0.40 + w * 0.7, y: 0.50 + h / 2 };
    lm[p6] = { x: 0.40 + w * 0.3, y: 0.50 + h / 2 };
  };
  place(CONFIG.eye.leftEyeIndices);
  place(CONFIG.eye.rightEyeIndices);
  return lm;
}

test('EyeFeatureExtractor emits both eyes and their mean', () => {
  const ex = new EyeFeatureExtractor(CONFIG);
  const out = ex.extract(landmarksWithEyes(0.30), 640, 480);
  close(out.earLeft, 0.30, 1e-6);
  close(out.earRight, 0.30, 1e-6);
  close(out.earMean, 0.30, 1e-6);
});

test('EAR is aspect-ratio independent (the Python harness bug)', () => {
  const ex = new EyeFeatureExtractor(CONFIG);
  const lm = landmarksWithEyes(0.30);
  const a = ex.extract(lm, 640, 480);    // 4:3
  const b = ex.extract(lm, 1280, 720);   // 16:9
  close(a.earMean, b.earMean, 1e-9);
});

test('legacy non-aspect-corrected mode reproduces the aspect dependence', () => {
  // Documents the old behaviour so the historical CSV can be interpreted.
  const legacy = withOverrides({ eye: { aspectCorrect: false } });
  const ex = new EyeFeatureExtractor(legacy);
  const lm = landmarksWithEyes(0.30);
  const a = ex.extract(lm, 640, 480);
  const b = ex.extract(lm, 1280, 720);
  assert.ok(Math.abs(a.earMean - b.earMean) > 1e-3,
    'legacy mode should differ across aspect ratios');
});

test('earMean is null when one eye is unmeasurable', () => {
  const ex = new EyeFeatureExtractor(CONFIG);
  const lm = landmarksWithEyes(0.30);
  for (const i of CONFIG.eye.leftEyeIndices) lm[i] = { x: NaN, y: NaN };
  const out = ex.extract(lm, 640, 480);
  assert.equal(out.earLeft, null);
  assert.ok(out.earRight !== null, 'the other eye still reports');
  assert.equal(out.earMean, null, 'mean must not silently fall back to one eye');
});
