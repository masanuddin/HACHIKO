/**
 * Unit tests — pure math primitives.
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeAngleDeg, median, percentile, robustSpread, ema,
  eyeAspectRatio, rotationMatrixToEuler, rotationFromMatrix,
  detectMatrixLayout, isValidRotationMatrix,
} from '../src/ai/index.js';

const D = Math.PI / 180;
const close = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);

// ── Angle normalization ─────────────────────────────────────────────────
// This is the direct guard against the Python harness's pitch defect, where
// 98.5% of logged values sat within 40 deg of +/-180.
test('normalizeAngleDeg maps into (-180, 180]', () => {
  close(normalizeAngleDeg(0), 0);
  close(normalizeAngleDeg(45), 45);
  close(normalizeAngleDeg(-45), -45);
  close(normalizeAngleDeg(180), 180);
  close(normalizeAngleDeg(-180), 180);   // boundary closes at +180
  close(normalizeAngleDeg(190), -170);
  close(normalizeAngleDeg(-190), 170);
  close(normalizeAngleDeg(360), 0);
  close(normalizeAngleDeg(720 + 30), 30);
  close(normalizeAngleDeg(-720 - 30), -30);
});

test('normalizeAngleDeg un-wraps the Python-style near-180 pitch values', () => {
  // Actual values sampled from log_20260820_112600.csv.
  for (const raw of [168.18, 169.21, -140.6, -178.26, 180, -180]) {
    const n = normalizeAngleDeg(raw);
    assert.ok(n > -180 && n <= 180, `${raw} -> ${n} out of range`);
  }
});

test('normalizeAngleDeg rejects non-finite input', () => {
  assert.ok(Number.isNaN(normalizeAngleDeg(NaN)));
  assert.ok(Number.isNaN(normalizeAngleDeg(Infinity)));
  assert.ok(Number.isNaN(normalizeAngleDeg(null)));
});

// ── Median / baseline statistics ────────────────────────────────────────
test('median handles odd, even, unsorted, and single values', () => {
  close(median([3, 1, 2]), 2);
  close(median([4, 1, 3, 2]), 2.5);
  close(median([7]), 7);
});

test('median ignores non-finite entries and returns null when empty', () => {
  close(median([1, NaN, 3, Infinity, 2]), 2);
  assert.equal(median([]), null);
  assert.equal(median([NaN, Infinity]), null);
});

test('median resists outliers that would move a mean (blink during calibration)', () => {
  // Nine normal EAR samples plus one blink near zero.
  const samples = [0.30, 0.31, 0.29, 0.30, 0.32, 0.30, 0.29, 0.31, 0.30, 0.02];
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const med = median(samples);
  assert.ok(med > 0.29, `median ${med} should stay near the true baseline`);
  assert.ok(mean < med, 'mean is dragged down by the blink, median is not');
});

test('percentile and robustSpread', () => {
  close(percentile([1, 2, 3, 4, 5], 0.5), 3);
  close(percentile([1, 2, 3, 4, 5], 0), 1);
  close(percentile([1, 2, 3, 4, 5], 1), 5);
  const spread = robustSpread([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(spread > 0 && spread < 9, `spread ${spread} should exclude extremes`);
});

// ── EMA smoothing ───────────────────────────────────────────────────────
test('ema seeds on first sample and converges toward the target', () => {
  let v = ema(null, 10, 0.5);
  close(v, 10);                       // seeded, not blended with 0
  v = ema(10, 20, 0.5);
  close(v, 15);
  v = ema(v, 20, 0.5);
  close(v, 17.5);
});

test('ema holds previous value when the new sample is invalid', () => {
  close(ema(12, NaN, 0.5), 12);
  close(ema(12, null, 0.5), 12);
});

test('ema frame-rate compensation keeps the time constant stable', () => {
  // Same elapsed time, different frame rates -> similar convergence.
  const alpha = 0.35, target = 100;
  let fast = 0;
  for (let i = 0; i < 30; i++) {
    fast = ema(fast, target, alpha, { compensate: true, dtMs: 1000 / 30, referenceFps: 30 });
  }
  let slow = 0;
  for (let i = 0; i < 10; i++) {
    slow = ema(slow, target, alpha, { compensate: true, dtMs: 100, referenceFps: 30 });
  }
  // Both represent ~1 second of smoothing.
  assert.ok(Math.abs(fast - slow) < 5,
    `compensated EMA should track time, got fast=${fast.toFixed(2)} slow=${slow.toFixed(2)}`);
});

// ── EAR ─────────────────────────────────────────────────────────────────
/** Build a symmetric synthetic eye: width w, lid opening h. */
function syntheticEye(w, h) {
  return [
    { x: 0, y: 0 },            // p1 outer corner
    { x: w * 0.3, y: -h / 2 }, // p2 upper
    { x: w * 0.7, y: -h / 2 }, // p3 upper
    { x: w, y: 0 },            // p4 inner corner
    { x: w * 0.7, y: h / 2 },  // p5 lower
    { x: w * 0.3, y: h / 2 },  // p6 lower
  ];
}

test('eyeAspectRatio matches the analytic value', () => {
  // verticals both = h, horizontal = w  =>  EAR = (h + h) / (2w) = h/w
  close(eyeAspectRatio(syntheticEye(100, 30)), 0.30);
  close(eyeAspectRatio(syntheticEye(100, 20)), 0.20);
});

test('eyeAspectRatio is scale invariant (uniform scaling cancels)', () => {
  const small = eyeAspectRatio(syntheticEye(10, 3));
  const large = eyeAspectRatio(syntheticEye(1000, 300));
  close(small, large);
});

test('eyeAspectRatio drops toward zero as the eye closes', () => {
  const open = eyeAspectRatio(syntheticEye(100, 30));
  const half = eyeAspectRatio(syntheticEye(100, 15));
  const shut = eyeAspectRatio(syntheticEye(100, 1));
  assert.ok(open > half && half > shut, 'EAR must decrease monotonically');
});

test('eyeAspectRatio returns null (never 0) for degenerate input', () => {
  // A 0 would read downstream as "eyes fully shut" and could trigger a state.
  const degenerate = syntheticEye(0, 10);
  assert.equal(eyeAspectRatio(degenerate), null);
  assert.equal(eyeAspectRatio([]), null);
  assert.equal(eyeAspectRatio(null), null);
  assert.equal(eyeAspectRatio([{ x: NaN, y: 0 }, ...syntheticEye(10, 3).slice(1)]), null);
});

// ── Rotation matrix -> Euler ────────────────────────────────────────────
function mul(A, B) {
  return A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
}
const Ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const Rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const Rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const compose = (y, p, r) => mul(mul(Ry(y * D), Rx(p * D)), Rz(r * D));

test('rotationMatrixToEuler round-trips single-axis rotations', () => {
  for (const yaw of [-60, -30, 0, 30, 60]) {
    const e = rotationMatrixToEuler(compose(yaw, 0, 0));
    close(e.yaw, yaw, 1e-6); close(e.pitch, 0, 1e-6); close(e.roll, 0, 1e-6);
  }
  for (const pitch of [-45, -20, 0, 20, 45]) {
    const e = rotationMatrixToEuler(compose(0, pitch, 0));
    close(e.pitch, pitch, 1e-6);
  }
  for (const roll of [-30, 0, 30]) {
    const e = rotationMatrixToEuler(compose(0, 0, roll));
    close(e.roll, roll, 1e-6);
  }
});

test('rotationMatrixToEuler round-trips combined rotations', () => {
  const cases = [[25, -15, 10], [-40, 30, -20], [60, -45, 25], [-70, 10, 5]];
  for (const [y, p, r] of cases) {
    const e = rotationMatrixToEuler(compose(y, p, r));
    close(e.yaw, y, 1e-6); close(e.pitch, p, 1e-6); close(e.roll, r, 1e-6);
  }
});

test('rotationMatrixToEuler NEVER emits wrapped near-180 angles', () => {
  // The regression this whole module exists to prevent.
  for (let y = -80; y <= 80; y += 10) {
    for (let p = -60; p <= 60; p += 10) {
      const e = rotationMatrixToEuler(compose(y, p, 0));
      assert.ok(Math.abs(e.pitch) <= 90 + 1e-6,
        `pitch ${e.pitch} implausible for input ${p}`);
      assert.ok(e.yaw > -180 && e.yaw <= 180);
      assert.ok(e.roll > -180 && e.roll <= 180);
    }
  }
});

test('rotationMatrixToEuler flags gimbal lock instead of wrapping', () => {
  const e = rotationMatrixToEuler(compose(0, 90, 0));
  assert.equal(e.gimbalLock, true);
  close(e.pitch, 90, 1e-6);
  close(e.roll, 0);              // pinned, not a wrapped artefact
});

test('rotationMatrixToEuler rejects malformed input', () => {
  assert.equal(rotationMatrixToEuler(null), null);
  assert.equal(rotationMatrixToEuler([[1, 0, 0], [0, 1, 0]]), null);
  assert.equal(rotationMatrixToEuler([[NaN, 0, 0], [0, 1, 0], [0, 0, 1]]), null);
});

// ── Matrix layout handling ──────────────────────────────────────────────
test('rotationFromMatrix reads column-major and row-major consistently', () => {
  const R = compose(20, -10, 5);
  const t = [1, 2, 3];
  // Column-major flat: columns laid out consecutively, translation at 12..14.
  const colMajor = [
    R[0][0], R[1][0], R[2][0], 0,
    R[0][1], R[1][1], R[2][1], 0,
    R[0][2], R[1][2], R[2][2], 0,
    t[0], t[1], t[2], 1,
  ];
  const got = rotationFromMatrix(colMajor, 'column-major');
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(got[i][j], R[i][j]);

  const e = rotationMatrixToEuler(got);
  close(e.yaw, 20, 1e-6); close(e.pitch, -10, 1e-6); close(e.roll, 5, 1e-6);
});

test('detectMatrixLayout identifies column-major from the homogeneous row', () => {
  const R = compose(15, 10, 0);
  const colMajor = [
    R[0][0], R[1][0], R[2][0], 0,
    R[0][1], R[1][1], R[2][1], 0,
    R[0][2], R[1][2], R[2][2], 0,
    5, 6, 7, 1,
  ];
  assert.equal(detectMatrixLayout(colMajor), 'column-major');

  const rowMajor = [
    R[0][0], R[0][1], R[0][2], 5,
    R[1][0], R[1][1], R[1][2], 6,
    R[2][0], R[2][1], R[2][2], 7,
    0, 0, 0, 1,
  ];
  assert.equal(detectMatrixLayout(rowMajor), 'row-major');
});

test('isValidRotationMatrix accepts rotations and rejects junk', () => {
  assert.equal(isValidRotationMatrix(compose(30, 20, 10)), true);
  assert.equal(isValidRotationMatrix([[2, 0, 0], [0, 2, 0], [0, 0, 2]]), false); // scaled
  assert.equal(isValidRotationMatrix([[1, 0, 0], [0, 1, 0], [0, 0, -1]]), false); // reflection
  assert.equal(isValidRotationMatrix([[0, 0, 0], [0, 0, 0], [0, 0, 0]]), false);
});
