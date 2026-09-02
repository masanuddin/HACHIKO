/**
 * HACHIKO AI v0.1 — FeatureSmoother
 * =================================
 * Frame-rate-compensated EMA over the calibrated signals.
 *
 * WHY: MediaPipe landmarks jitter by a degree or two even on a perfectly still
 * head. Feeding raw values into a threshold comparison makes the persistence
 * timer reset on noise alone — exactly the Python harness's behaviour, where a
 * single frame under threshold cleared `distracted_since` entirely.
 *
 * Smoothing here is deliberately mild: it removes jitter without adding enough
 * lag to matter against persistence windows measured in seconds.
 */

import { ema, isFiniteNumber } from '../core/math.js';

export class FeatureSmoother {
  /** @param {import('../config.js').CONFIG} config */
  constructor(config) {
    this.config = config;
    this.reset();
  }

  reset() {
    this.yawSmoothed = null;
    this.pitchSmoothed = null;
    this.rollSmoothed = null;
    this.earSmoothed = null;
    this._lastMs = null;
  }

  /**
   * @param {{yawDelta:number|null, pitchDelta:number|null, rollDelta:number|null,
   *          earRelative:number|null}} calibrated
   * @param {number} nowMs
   * @returns {{yawSmoothed:number|null, pitchSmoothed:number|null,
   *            rollSmoothed:number|null, earSmoothed:number|null}}
   */
  update(calibrated, nowMs) {
    const t = this.config.temporal;

    let dtMs = null;
    if (isFiniteNumber(this._lastMs)) {
      dtMs = nowMs - this._lastMs;
      // A huge gap means the tab was throttled or the machine slept. Restart
      // the filter rather than letting one stale sample dominate.
      if (dtMs > t.maxFrameDeltaMs || dtMs <= 0) {
        this.yawSmoothed = null;
        this.pitchSmoothed = null;
        this.rollSmoothed = null;
        this.earSmoothed = null;
        dtMs = null;
      }
    }
    this._lastMs = nowMs;

    const opts = {
      compensate: t.frameRateCompensate && isFiniteNumber(dtMs),
      dtMs,
      referenceFps: t.referenceFps,
    };

    // Null input holds the previous smoothed value rather than resetting it:
    // a momentary invalid frame should not erase seconds of accumulated signal.
    this.yawSmoothed = this._step(this.yawSmoothed, calibrated.yawDelta, opts);
    this.pitchSmoothed = this._step(this.pitchSmoothed, calibrated.pitchDelta, opts);
    this.rollSmoothed = this._step(this.rollSmoothed, calibrated.rollDelta, opts);
    this.earSmoothed = this._step(this.earSmoothed, calibrated.earRelative, opts);

    return {
      yawSmoothed: this.yawSmoothed,
      pitchSmoothed: this.pitchSmoothed,
      rollSmoothed: this.rollSmoothed,
      earSmoothed: this.earSmoothed,
    };
  }

  _step(prev, next, opts) {
    if (!isFiniteNumber(next)) return prev;
    const out = ema(prev, next, this.config.temporal.EMA_ALPHA, opts);
    return isFiniteNumber(out) ? out : prev;
  }
}

export default FeatureSmoother;
