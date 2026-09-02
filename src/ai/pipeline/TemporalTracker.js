/**
 * HACHIKO AI v0.1 — TemporalTracker
 * =================================
 * Turns instantaneous conditions into SUSTAINED evidence.
 *
 * Nothing in HACHIKO is classified frame-by-frame. Every signal must hold for a
 * configured duration before it counts, and brief interruptions do not reset
 * the clock.
 *
 * TWO PRIMITIVES:
 *
 *  PersistenceTimer — "has condition C held for >= N ms?", tolerant of short
 *  gaps. The Python harness used `x = x or now` / `x = None`, so ONE frame
 *  below threshold discarded all accumulated time. Landmark jitter alone was
 *  enough to do that.
 *
 *  FaceMissingTracker — accumulates absence with a recovery requirement, so a
 *  single dropped frame can never reach TIDAK_HADIR, and a single detected
 *  frame during a real absence cannot instantly cancel it.
 */

import { isFiniteNumber } from '../core/math.js';

/**
 * Tracks how long a boolean condition has been continuously true, allowing
 * brief dropouts (default: one persistence-window-independent grace).
 */
export class PersistenceTimer {
  /**
   * @param {number} requiredMs   how long the condition must hold
   * @param {number} [toleranceMs=300] gap length forgiven without resetting
   */
  constructor(requiredMs, toleranceMs = 300) {
    this.requiredMs = requiredMs;
    this.toleranceMs = toleranceMs;
    this.reset();
  }

  reset() {
    this.activeSinceMs = null;
    this.lastTrueMs = null;
    this.accumulatedMs = 0;
  }

  /**
   * @param {boolean} conditionMet
   * @param {number} nowMs
   * @returns {boolean} true once the condition has persisted >= requiredMs
   */
  update(conditionMet, nowMs) {
    if (conditionMet) {
      if (this.activeSinceMs === null) {
        this.activeSinceMs = nowMs;
      }
      this.lastTrueMs = nowMs;
    } else if (this.activeSinceMs !== null) {
      // Condition dropped. Forgive it only if the gap is short — this is what
      // makes the timer immune to single-frame landmark jitter.
      const gap = nowMs - (this.lastTrueMs ?? nowMs);
      if (gap > this.toleranceMs) this.reset();
    }

    this.accumulatedMs =
      this.activeSinceMs === null ? 0 : Math.max(0, nowMs - this.activeSinceMs);
    return this.isSatisfied();
  }

  isSatisfied() {
    return this.activeSinceMs !== null && this.accumulatedMs >= this.requiredMs;
  }

  /** Allow config changes without losing the object identity. */
  setRequiredMs(ms) {
    this.requiredMs = ms;
  }
}

/**
 * Accumulates face-absence evidence, and requires sustained presence to clear.
 *
 * ── SEMANTICS OF `faceMissingMs` (clarified in the v0.2 live gate) ────────
 * `faceMissingMs` is RETAINED ABSENCE EVIDENCE, not "current consecutive
 * missing time". It keeps accumulating while the face is missing, and is only
 * zeroed once the face has been continuously present for `recoverMs`. So it
 * can legitimately read non-zero on a frame where `facePresent === true`.
 *
 * A real Gate-1 run showed exactly this: during extreme yaw a snapshot had
 * `facePresent: true` alongside ~582 ms of accumulated absence — the landmarker
 * had briefly lost the face, and presence had not yet been sustained long
 * enough to clear the evidence. That is the design working, not a bug.
 *
 * The retention is deliberate: it stops a single lucky detection frame from
 * cancelling a real absence.
 *
 * ── KNOWN LIMITATION (not fixed in v0.2, needs live reproduction) ─────────
 * Because presence shorter than `recoverMs` never clears the counter, a
 * sustained FLICKER — repeated dropouts each followed by less than `recoverMs`
 * of detection — accumulates without bound and can eventually reach
 * TIDAK_HADIR while the user is physically present. Simulation: 200 ms missing
 * / 400 ms present, repeated, crosses the 2000 ms threshold within seconds.
 *
 * This has NOT been reproduced on hardware. The acceptance protocol adds
 * EXTREME_YAW_HELD_5S to test for it. Do not change the absence rule until it
 * is observed live; if it is, the likely fix is decaying `faceMissingMs`
 * during presence rather than requiring one uninterrupted recovery window.
 */
export class FaceMissingTracker {
  /**
   * @param {number} enterMs   absence needed before considered truly absent
   * @param {number} recoverMs presence needed before absence is cleared
   */
  constructor(enterMs, recoverMs) {
    this.enterMs = enterMs;
    this.recoverMs = recoverMs;
    this.reset();
  }

  reset() {
    this.faceMissingMs = 0;
    this.facePresentMs = 0;
    this._lastMs = null;
    this._absent = false;
  }

  /**
   * @param {boolean} facePresent
   * @param {number} nowMs
   * @param {number} [maxFrameDeltaMs=500] ignore absurd gaps
   * @returns {{absent:boolean, faceMissingMs:number, facePresentMs:number}}
   */
  update(facePresent, nowMs, maxFrameDeltaMs = 500) {
    let dt = 0;
    if (isFiniteNumber(this._lastMs)) {
      dt = nowMs - this._lastMs;
      // Don't credit a suspended tab as seconds of absence — that would fire a
      // false TIDAK_HADIR the instant the student switches back.
      if (dt < 0 || dt > maxFrameDeltaMs) dt = 0;
    }
    this._lastMs = nowMs;

    if (facePresent) {
      this.facePresentMs += dt;
      // Presence must be sustained before we clear accumulated absence.
      if (this.facePresentMs >= this.recoverMs) {
        this.faceMissingMs = 0;
        this._absent = false;
      }
    } else {
      this.faceMissingMs += dt;
      this.facePresentMs = 0;
      if (this.faceMissingMs >= this.enterMs) {
        this._absent = true;
      }
    }

    return {
      absent: this._absent,
      faceMissingMs: this.faceMissingMs,
      facePresentMs: this.facePresentMs,
    };
  }

  isAbsent() {
    return this._absent;
  }
}

/**
 * Owns a persistence timer per evidence source, plus the presence tracker.
 *
 * v0.2: each of the five sources has its OWN window, because they represent
 * behaviours on different timescales — a glance is not a nap. Threshold
 * comparison and directionality live in EvidenceEngine; this class only asks
 * "has this condition held long enough?".
 */
export class TemporalTracker {
  /**
   * @param {import('../config.js').CONFIG} config
   * @param {import('./EvidenceEngine.js').EvidenceEngine} evidenceEngine
   */
  constructor(config, evidenceEngine) {
    this.config = config;
    this.evidence = evidenceEngine;
    const s = config.state;

    // Tolerance scales with the window: a longer requirement can forgive a
    // longer blip without meaningfully weakening it. Capped so a short window
    // never becomes trivially satisfiable.
    const tol = (ms) => Math.min(400, ms / 3);

    this.timers = {
      yawStrong: new PersistenceTimer(s.YAW_PERSIST_MS, tol(s.YAW_PERSIST_MS)),
      pitchUpStrong: new PersistenceTimer(s.PITCH_UP_PERSIST_MS, tol(s.PITCH_UP_PERSIST_MS)),
      eyeClosureStrong: new PersistenceTimer(s.EYE_CLOSED_PERSIST_MS, tol(s.EYE_CLOSED_PERSIST_MS)),
      pitchDownSupport: new PersistenceTimer(s.DOWN_PITCH_SUPPORT_PERSIST_MS, tol(s.DOWN_PITCH_SUPPORT_PERSIST_MS)),
      rollSupport: new PersistenceTimer(s.ROLL_SUPPORT_PERSIST_MS, tol(s.ROLL_SUPPORT_PERSIST_MS)),
    };
    this.faceTracker = new FaceMissingTracker(s.FACE_MISSING_ENTER_MS, s.FACE_PRESENT_RECOVER_MS);
  }

  reset() {
    for (const timer of Object.values(this.timers)) timer.reset();
    this.faceTracker.reset();
  }

  /**
   * @param {Object} input
   * @param {boolean} input.facePresent
   * @param {boolean} input.signalValid   pose+calibration usable this frame
   * @param {number|null} input.yawSmoothed
   * @param {number|null} input.pitchSmoothed
   * @param {number|null} input.rollSmoothed
   * @param {number|null} input.earSmoothed
   * @param {number} nowMs
   */
  update(input, nowMs) {
    const face = this.faceTracker.update(
      input.facePresent, nowMs, this.config.temporal.maxFrameDeltaMs
    );

    // Evidence is only evaluated when the signal is usable. When it is not we
    // feed `false`, but each timer's own tolerance keeps a short invalid
    // stretch from wiping seconds of accumulated evidence.
    const usable = input.facePresent && input.signalValid;
    const instant = this.evidence.evaluateInstantaneous(input, usable);
    const flat = { ...instant.strong, ...instant.support };

    const persisted = {};
    const accumulated = {};
    for (const [key, timer] of Object.entries(this.timers)) {
      persisted[key] = timer.update(!!flat[key], nowMs);
      accumulated[key] = timer.accumulatedMs;
    }

    // Eye-closure evidence is geometry-gated. A PersistenceTimer normally
    // forgives short gaps (that tolerance is what makes it immune to landmark
    // jitter), but ineligibility is not jitter — it means the measurement is
    // meaningless at this head angle. So we hard-reset rather than relying on
    // the tolerance window, otherwise turning the head briefly could carry
    // stale eye-closure accumulation across the ineligible stretch.
    if (!instant.eyeEligible) {
      this.timers.eyeClosureStrong.reset();
      persisted.eyeClosureStrong = false;
      accumulated.eyeClosureStrong = 0;
    }

    return {
      persisted,
      instantaneous: flat,
      accumulated,
      eyeEligible: instant.eyeEligible,
      eyeIneligibleReason: instant.eyeIneligibleReason,
      faceAbsent: face.absent,
      faceMissingMs: face.faceMissingMs,
      facePresentMs: face.facePresentMs,
    };
  }
}

export default TemporalTracker;
