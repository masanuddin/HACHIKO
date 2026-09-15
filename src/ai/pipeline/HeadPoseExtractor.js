/**
 * HACHIKO AI v0.1 — HeadPoseExtractor
 * ===================================
 * Converts MediaPipe's facial transformation matrix into canonical yaw / pitch
 * / roll in degrees.
 *
 * WHY NOT solvePnP (the Python harness approach):
 *   baseline_detection.py fed 6 landmarks into cv2.solvePnP with a guessed
 *   focal length (= frame width), zero distortion, and a generic 3D head model,
 *   then ran the result through cv2.decomposeProjectionMatrix. That returned an
 *   un-normalized Euler branch: 98.5% of its logged pitch landed within 40 deg
 *   of +/-180 and was unusable.
 *
 *   MediaPipe already solves this internally and exposes a proper 4x4 rigid
 *   transform via `outputFacialTransformationMatrixes`. Using it removes the
 *   guessed intrinsics, the extra solve, and the wrap bug in one step.
 *
 * INVARIANT: a failed or implausible solve NEVER becomes 0 degrees. It returns
 * poseValid=false with nulls and a machine-readable reason.
 */

import {
  rotationFromMatrix,
  detectMatrixLayout,
  isValidRotationMatrix,
  rotationMatrixToEuler,
  isFiniteNumber,
} from '../core/math.js';
import { PoseInvalidReason } from '../types.js';

/** @typedef {import('../types.js').Measurement} Measurement */

const INVALID = Object.freeze({
  poseValid: false,
  yawRaw: null,
  pitchRaw: null,
  rollRaw: null,
  gimbalLock: false,
});

function invalid(reason) {
  return { ...INVALID, poseInvalidReason: reason };
}

export class HeadPoseExtractor {
  /** @param {import('../config.js').CONFIG} config */
  constructor(config) {
    this.config = config;
    /** Layout resolved once from real data when configured 'auto'. */
    this.resolvedLayout = config.headPose.matrixLayout === 'auto'
      ? null
      : config.headPose.matrixLayout;
  }

  /**
   * Which flat-array layout is in use. Null until the first matrix is seen
   * (only when config is 'auto'). Surfaced for the debug harness.
   */
  getResolvedLayout() {
    return this.resolvedLayout;
  }

  /**
   * @param {{data:number[]|Float32Array}|null|undefined} matrix
   *        MediaPipe MatrixData: flat 16 values plus rows/columns.
   * @returns {{poseValid:boolean, yawRaw:number|null, pitchRaw:number|null,
   *            rollRaw:number|null, poseInvalidReason:string, gimbalLock:boolean}}
   */
  extract(matrix) {
    if (!matrix || !matrix.data || matrix.data.length < 16) {
      return invalid(PoseInvalidReason.NO_MATRIX);
    }
    const data = matrix.data;

    for (let i = 0; i < 16; i++) {
      if (!isFiniteNumber(data[i])) return invalid(PoseInvalidReason.NON_FINITE);
    }

    // Resolve storage layout once, from actual data, then reuse.
    if (this.resolvedLayout === null) {
      this.resolvedLayout = detectMatrixLayout(data);
    }

    const R = rotationFromMatrix(data, this.resolvedLayout);
    if (!R) return invalid(PoseInvalidReason.NO_MATRIX);

    // Reject reflections / scaled / degenerate matrices before trusting angles.
    if (!isValidRotationMatrix(R)) {
      return invalid(PoseInvalidReason.DEGENERATE_MATRIX);
    }

    const euler = rotationMatrixToEuler(R);
    if (!euler) return invalid(PoseInvalidReason.NON_FINITE);

    // ── CANONICALIZATION BOUNDARY ──────────────────────────────────────
    // This is the ONLY place device axis direction is normalised. Everything
    // downstream (deltas, smoothing, evidence, state, telemetry) consumes the
    // canonical convention documented in config.headPose and in
    // docs/HEAD_POSE_CONVENTION.md:
    //
    //   yaw > 0 = turning to own LEFT   pitch > 0 = UP   roll > 0 = own RIGHT
    //
    // Downstream code must never re-flip a sign to compensate for hardware.
    const hp = this.config.headPose;
    let { yaw, pitch, roll } = euler;
    if (hp.invertYaw) yaw = -yaw;
    if (hp.invertPitch) pitch = -pitch;
    if (hp.invertRoll) roll = -roll;

    // Plausibility gate. A human head does not exceed these relative to a
    // camera it is facing; anything beyond indicates a bad solve, and emitting
    // it would poison both the baseline median and the state engine.
    if (
      Math.abs(yaw) > hp.maxPlausibleYawDeg ||
      Math.abs(pitch) > hp.maxPlausiblePitchDeg ||
      Math.abs(roll) > hp.maxPlausibleRollDeg
    ) {
      return invalid(PoseInvalidReason.IMPLAUSIBLE_ANGLE);
    }

    return {
      poseValid: true,
      yawRaw: yaw,
      pitchRaw: pitch,
      rollRaw: roll,
      poseInvalidReason: PoseInvalidReason.NONE,
      gimbalLock: euler.gimbalLock,
    };
  }
}

export default HeadPoseExtractor;
