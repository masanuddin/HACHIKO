/**
 * HACHIKO AI v0.1 — CalibrationEngine
 * ===================================
 * Collects a short baseline at session start so every downstream threshold is
 * RELATIVE to this student, on this laptop, at this camera angle.
 *
 * WHY THIS EXISTS. The Python harness compared against absolute constants
 * (|yaw| > 30 deg, EAR < 0.21). Its own log shows why that fails: median EAR
 * over 5,609 valid frames was 0.20 against a 0.21 threshold — the threshold cut
 * the subject's distribution almost exactly in half, so "eyes closed" fired
 * constantly. Eye shape, camera height, and seating posture vary far too much
 * between students for absolute numbers to transfer.
 *
 * ROBUSTNESS: baseline uses the MEDIAN of valid samples, never a single frame
 * and never a mean, so a blink or one bad solve during calibration cannot move
 * it. Invalid frames are discarded, not counted as zeros.
 */

import { median, robustSpread, isFiniteNumber } from '../core/math.js';
import { CalibrationStatus } from '../types.js';

export class CalibrationEngine {
  /** @param {import('../config.js').CONFIG} config */
  constructor(config) {
    this.config = config;
    this.reset();
  }

  reset() {
    this.status = CalibrationStatus.UNCALIBRATED;
    this.startedAtMs = null;
    this.totalFrames = 0;
    this._yaw = [];
    this._pitch = [];
    this._roll = [];
    this._ear = [];
    this.baseline = null;
    this.failureReason = null;
  }

  /** Begin collecting. `nowMs` is the caller's clock (monotonic). */
  start(nowMs) {
    this.reset();
    this.status = CalibrationStatus.COLLECTING;
    this.startedAtMs = nowMs;
  }

  isCollecting() {
    return this.status === CalibrationStatus.COLLECTING;
  }

  isValid() {
    return this.status === CalibrationStatus.VALID && this.baseline !== null;
  }

  /** 0..1 progress through the collection window. */
  progress(nowMs) {
    if (!this.isCollecting()) return this.isValid() ? 1 : 0;
    const elapsed = nowMs - this.startedAtMs;
    const total = this.config.calibration.CALIBRATION_DURATION_MS;
    return Math.max(0, Math.min(1, elapsed / total));
  }

  /**
   * Feed one frame. Only fully valid frames contribute.
   * @param {Object} measurement  from FaceLandmarkerEngine
   * @param {number} nowMs
   * @returns {boolean} true when the window just closed (status settled)
   */
  update(measurement, nowMs) {
    if (!this.isCollecting()) return false;

    this.totalFrames += 1;

    // Require face AND valid pose AND both eyes. A frame missing any of these
    // tells us nothing about the student's neutral posture.
    if (
      measurement.facePresent &&
      measurement.poseValid &&
      isFiniteNumber(measurement.yawRaw) &&
      isFiniteNumber(measurement.pitchRaw) &&
      isFiniteNumber(measurement.earMean)
    ) {
      this._yaw.push(measurement.yawRaw);
      this._pitch.push(measurement.pitchRaw);
      this._ear.push(measurement.earMean);
      // Roll is optional: a valid pose always has it, but we guard anyway so a
      // partial measurement cannot poison the roll baseline with undefined.
      if (isFiniteNumber(measurement.rollRaw)) this._roll.push(measurement.rollRaw);
    }

    const elapsed = nowMs - this.startedAtMs;
    if (elapsed >= this.config.calibration.CALIBRATION_DURATION_MS) {
      this._finalize();
      return true;
    }
    return false;
  }

  /** Evaluate quality gates and settle into VALID or FAILED. */
  _finalize() {
    const cfg = this.config.calibration;
    const n = this._yaw.length;

    if (n < cfg.minValidSamples) {
      return this._fail(
        `insufficient valid samples: ${n} < ${cfg.minValidSamples}`
      );
    }
    if (this.totalFrames > 0 && n / this.totalFrames < cfg.minValidRatio) {
      return this._fail(
        `valid ratio ${(n / this.totalFrames).toFixed(2)} < ${cfg.minValidRatio}`
      );
    }

    // Reject a baseline captured while the student was moving or already
    // looking away — that would bake the distraction into "neutral".
    const yawSpread = robustSpread(this._yaw);
    const pitchSpread = robustSpread(this._pitch);
    if (yawSpread !== null && yawSpread > cfg.maxBaselineYawSpreadDeg) {
      return this._fail(
        `yaw unstable during calibration (spread ${yawSpread.toFixed(1)} deg)`
      );
    }
    if (pitchSpread !== null && pitchSpread > cfg.maxBaselinePitchSpreadDeg) {
      return this._fail(
        `pitch unstable during calibration (spread ${pitchSpread.toFixed(1)} deg)`
      );
    }

    const earBaseline = median(this._ear);
    // A very low EAR baseline means eyes were shut/squinting throughout. Using
    // it would make earRelative ~1.0 while asleep — silently disabling the
    // eye-closure rule for the whole session.
    if (earBaseline === null || earBaseline < cfg.minBaselineEar) {
      return this._fail(
        `EAR baseline too low (${earBaseline === null ? 'none' : earBaseline.toFixed(3)})`
      );
    }

    this.baseline = {
      yaw: median(this._yaw),
      pitch: median(this._pitch),
      // Roll baseline captures the student's natural resting tilt, so rollDelta
      // measures deviation from THEIR posture rather than from vertical.
      roll: median(this._roll) ?? 0,
      ear: earBaseline,
      sampleCount: n,
      totalFrames: this.totalFrames,
      yawSpread,
      pitchSpread,
    };
    this.status = CalibrationStatus.VALID;
    this.failureReason = null;
  }

  _fail(reason) {
    this.status = CalibrationStatus.FAILED;
    this.failureReason = reason;
    this.baseline = null;
  }

  /**
   * Express a raw measurement relative to baseline.
   * Returns nulls when uncalibrated — never fabricates a delta of 0, which the
   * state engine would misread as "perfectly neutral".
   * @returns {{yawDelta:number|null, pitchDelta:number|null, earRelative:number|null}}
   */
  applyTo(measurement) {
    const none = {
      yawDelta: null, pitchDelta: null, rollDelta: null, earRelative: null,
    };
    if (!this.isValid()) return none;
    const b = this.baseline;

    return {
      yawDelta: isFiniteNumber(measurement.yawRaw)
        ? measurement.yawRaw - b.yaw : null,
      // Signed, and it must stay signed: v0.2 treats upward and downward pitch
      // as different kinds of evidence.
      pitchDelta: isFiniteNumber(measurement.pitchRaw)
        ? measurement.pitchRaw - b.pitch : null,
      rollDelta: isFiniteNumber(measurement.rollRaw)
        ? measurement.rollRaw - b.roll : null,
      earRelative:
        isFiniteNumber(measurement.earMean) && b.ear > 0
          ? measurement.earMean / b.ear : null,
    };
  }

  /** Serializable snapshot for the debug UI and telemetry header. */
  snapshot() {
    return {
      status: this.status,
      baseline: this.baseline ? { ...this.baseline } : null,
      failureReason: this.failureReason,
      validSamples: this._yaw.length,
      totalFrames: this.totalFrames,
    };
  }
}

export default CalibrationEngine;
