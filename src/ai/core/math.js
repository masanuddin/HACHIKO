/**
 * HACHIKO AI v0.1 — Pure math primitives
 * ======================================
 * Zero dependencies, zero side effects, no DOM, no webcam. Every function here
 * is deterministic and unit-testable in plain Node.
 */

export const RAD2DEG = 180 / Math.PI;
export const DEG2RAD = Math.PI / 180;

/** True only for real, finite numbers (rejects NaN, Infinity, null, ''). */
export function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Normalize an angle into (-180, 180].
 *
 * This is the direct fix for the defect found in the Python harness, where
 * cv2.decomposeProjectionMatrix returned an un-normalized Euler branch and
 * 98.5% of logged pitch sat within 40 degrees of +/-180. Any angle pipeline in
 * v0.1 must pass through here.
 *
 * @param {number} deg
 * @returns {number} equivalent angle in (-180, 180]
 */
export function normalizeAngleDeg(deg) {
  if (!isFiniteNumber(deg)) return NaN;
  // Bring into [0, 360) first; JS % keeps the sign of the dividend.
  let a = deg % 360;
  if (a <= -180) a += 360;
  else if (a > 180) a -= 360;
  // Guard the exact -180 boundary so the range is closed at +180 only.
  if (a === -180) a = 180;
  return a;
}

/**
 * Median of a numeric array. Non-finite entries are ignored.
 * Chosen over mean for baselines: a single bad frame (blink, mis-solve) shifts
 * a mean but not a median.
 * @param {number[]} values
 * @returns {number|null} null when no finite values exist
 */
export function median(values) {
  const clean = [];
  for (const v of values) if (isFiniteNumber(v)) clean.push(v);
  if (clean.length === 0) return null;
  clean.sort((a, b) => a - b);
  const mid = clean.length >> 1;
  return clean.length % 2 === 1
    ? clean[mid]
    : (clean[mid - 1] + clean[mid]) / 2;
}

/**
 * Percentile (linear interpolation), used for spread checks.
 * @param {number[]} values
 * @param {number} p 0..1
 */
export function percentile(values, p) {
  const clean = [];
  for (const v of values) if (isFiniteNumber(v)) clean.push(v);
  if (clean.length === 0) return null;
  clean.sort((a, b) => a - b);
  if (clean.length === 1) return clean[0];
  const idx = p * (clean.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return clean[lo];
  return clean[lo] + (clean[hi] - clean[lo]) * (idx - lo);
}

/**
 * Robust spread: p90 - p10. Less alarmist than max-min, which a single
 * outlier frame can blow up.
 */
export function robustSpread(values) {
  const hi = percentile(values, 0.9);
  const lo = percentile(values, 0.1);
  if (hi === null || lo === null) return null;
  return hi - lo;
}

/** Euclidean distance between two {x, y} points. */
export function distance2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Clamp helper. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Exponential moving average, optionally compensated for frame-rate drift.
 *
 * Plain EMA with a fixed alpha has a time constant measured in FRAMES, so if
 * FPS drops from 30 to 12 the filter silently becomes ~2.5x slower in wall
 * time. We rescale alpha to hold the half-life constant in TIME:
 *
 *   alphaEffective = 1 - (1 - alpha) ^ (dt / referenceDt)
 *
 * @param {number|null} prev  previous EMA output (null seeds the filter)
 * @param {number} next       new sample
 * @param {number} alpha      base smoothing factor at referenceFps
 * @param {Object} [opts]
 * @param {boolean} [opts.compensate=false]
 * @param {number}  [opts.dtMs]
 * @param {number}  [opts.referenceFps=30]
 * @returns {number}
 */
export function ema(prev, next, alpha, opts = {}) {
  if (!isFiniteNumber(next)) return isFiniteNumber(prev) ? prev : NaN;
  if (!isFiniteNumber(prev)) return next;   // seed on first valid sample

  let a = clamp(alpha, 0, 1);
  const { compensate = false, dtMs, referenceFps = 30 } = opts;
  if (compensate && isFiniteNumber(dtMs) && dtMs > 0) {
    const referenceDt = 1000 / referenceFps;
    const ratio = dtMs / referenceDt;
    a = 1 - Math.pow(1 - a, ratio);
    a = clamp(a, 0, 1);
  }
  return prev + a * (next - prev);
}

/**
 * Extract a 3x3 rotation block from MediaPipe's 4x4 facial transformation
 * matrix, honouring the declared storage layout.
 *
 * MediaPipe ships this as a MatrixData proto: a flat `data` array plus `rows`
 * and `columns`. The proto's documented default packing is COLUMN-MAJOR, but
 * we never rely on that silently — callers pass an explicit layout, and
 * `detectMatrixLayout` can infer it from the data itself.
 *
 * @param {number[]|Float32Array} data flat 16 values
 * @param {'column-major'|'row-major'} layout
 * @returns {number[][]|null} 3x3 row-indexed R, or null if unusable
 */
export function rotationFromMatrix(data, layout = 'column-major') {
  if (!data || data.length < 16) return null;
  for (let i = 0; i < 16; i++) if (!isFiniteNumber(data[i])) return null;

  // at(row, col) resolves the flat index for the given layout.
  const at = layout === 'row-major'
    ? (r, c) => data[r * 4 + c]
    : (r, c) => data[c * 4 + r];

  return [
    [at(0, 0), at(0, 1), at(0, 2)],
    [at(1, 0), at(1, 1), at(1, 2)],
    [at(2, 0), at(2, 1), at(2, 2)],
  ];
}

/**
 * Infer the storage layout of a 4x4 transformation matrix.
 *
 * A rigid transform stores translation in the last COLUMN (column-major flat
 * indices 12,13,14) or the last ROW (row-major flat indices 3,7,11). The other
 * triple is then the homogeneous row [0,0,0], so whichever triple is ~zero
 * tells us the layout. Falls back to the documented column-major default.
 *
 * @param {number[]|Float32Array} data
 * @returns {'column-major'|'row-major'}
 */
export function detectMatrixLayout(data) {
  if (!data || data.length < 16) return 'column-major';
  const magnitude = (i, j, k) =>
    Math.abs(data[i]) + Math.abs(data[j]) + Math.abs(data[k]);

  const colMajorHomogeneous = magnitude(3, 7, 11);  // should be ~0
  const rowMajorHomogeneous = magnitude(12, 13, 14); // should be ~0

  const EPS = 1e-6;
  const colLooksRight = colMajorHomogeneous < EPS;
  const rowLooksRight = rowMajorHomogeneous < EPS;

  if (colLooksRight && !rowLooksRight) return 'column-major';
  if (rowLooksRight && !colLooksRight) return 'row-major';
  // Ambiguous (e.g. zero translation): trust whichever is smaller, tie -> proto default.
  return rowMajorHomogeneous < colMajorHomogeneous ? 'row-major' : 'column-major';
}

/**
 * Verify a 3x3 matrix is a proper rotation: orthonormal with determinant +1.
 * Rejects reflections and degenerate/scaled matrices before we trust angles
 * derived from them.
 * @param {number[][]} R
 * @param {number} [tol=1e-2] generous: MediaPipe returns float32 with some scale drift
 */
export function isValidRotationMatrix(R, tol = 1e-2) {
  if (!R || R.length !== 3) return false;
  for (const row of R) {
    if (!row || row.length !== 3) return false;
    for (const v of row) if (!isFiniteNumber(v)) return false;
  }
  // Column norms should all be ~1.
  for (let c = 0; c < 3; c++) {
    const n = Math.hypot(R[0][c], R[1][c], R[2][c]);
    if (Math.abs(n - 1) > tol) return false;
  }
  const det =
    R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) -
    R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) +
    R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
  return Math.abs(det - 1) <= tol * 3;
}

/**
 * Decompose a rotation matrix into intrinsic Tait-Bryan angles, degrees.
 *
 * Convention: Y-X-Z (yaw about Y, pitch about X, roll about Z), the natural
 * parameterisation for a head. Angles come back already normalized to
 * (-180, 180], and gimbal lock (pitch ~ +/-90) is handled explicitly rather
 * than producing the +/-180 wrap that corrupted the Python harness.
 *
 * @param {number[][]} R 3x3
 * @returns {{yaw:number, pitch:number, roll:number, gimbalLock:boolean}|null}
 */
export function rotationMatrixToEuler(R) {
  if (!R || R.length !== 3) return null;
  for (const row of R) {
    if (!row || row.length !== 3) return null;
    for (const v of row) if (!isFiniteNumber(v)) return null;
  }

  // For intrinsic Y-X-Z, expanding R = Ry(yaw) * Rx(pitch) * Rz(roll) gives:
  //   R[1][2] = -sin(pitch)
  //   R[0][2] =  sin(yaw)  * cos(pitch)     R[2][2] = cos(yaw)  * cos(pitch)
  //   R[1][0] =  cos(pitch) * sin(roll)     R[1][1] = cos(pitch) * cos(roll)
  // (Derived and verified against composed rotations; see tests/math.test.js.)
  const sinPitch = clamp(-R[1][2], -1, 1);
  const pitch = Math.asin(sinPitch);

  const GIMBAL_EPS = 1e-4;
  const cosPitch = Math.cos(pitch);
  let yaw;
  let roll;
  let gimbalLock = false;

  if (Math.abs(cosPitch) < GIMBAL_EPS) {
    // Looking straight up/down: yaw and roll are not separable. Attribute all
    // rotation to yaw and pin roll to 0 rather than emitting a wrapped value.
    gimbalLock = true;
    yaw = Math.atan2(R[2][0], R[0][0]);
    roll = 0;
  } else {
    yaw = Math.atan2(R[0][2], R[2][2]);
    roll = Math.atan2(R[1][0], R[1][1]);
  }

  return {
    yaw: normalizeAngleDeg(yaw * RAD2DEG),
    pitch: normalizeAngleDeg(pitch * RAD2DEG),
    roll: normalizeAngleDeg(roll * RAD2DEG),
    gimbalLock,
  };
}

/**
 * Eye Aspect Ratio (Soukupova & Cech 2016).
 *
 *            ||p2 - p6|| + ||p3 - p5||
 *   EAR  =  ---------------------------
 *                 2 * ||p1 - p4||
 *
 * Points must be ordered [p1..p6] = [outer corner, upper lid a, upper lid b,
 * inner corner, lower lid b, lower lid a].
 *
 * Callers must supply points already scaled UNIFORMLY (same factor on x and y).
 * Scaling x by width and y by height — as the Python harness did — makes EAR a
 * function of aspect ratio and breaks cross-device comparability.
 *
 * @param {{x:number,y:number}[]} pts exactly 6
 * @returns {number|null} null if degenerate or malformed
 */
export function eyeAspectRatio(pts) {
  if (!pts || pts.length !== 6) return null;
  for (const p of pts) {
    if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return null;
  }
  const [p1, p2, p3, p4, p5, p6] = pts;
  const vertical1 = distance2D(p2, p6);
  const vertical2 = distance2D(p3, p5);
  const horizontal = distance2D(p1, p4);

  // Degenerate horizontal -> undefined ratio. Return null, never 0: a 0 would
  // read downstream as "eyes fully shut" and could trigger EYE_CLOSURE.
  if (!isFiniteNumber(horizontal) || horizontal < 1e-9) return null;

  const ear = (vertical1 + vertical2) / (2 * horizontal);
  return isFiniteNumber(ear) ? ear : null;
}

export default {
  RAD2DEG, DEG2RAD, isFiniteNumber, normalizeAngleDeg, median, percentile,
  robustSpread, distance2D, clamp, ema, rotationFromMatrix, detectMatrixLayout,
  isValidRotationMatrix, rotationMatrixToEuler, eyeAspectRatio,
};
