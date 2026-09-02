/**
 * HACHIKO AI v0.1 — StateEngine
 * =============================
 * Maps sustained temporal evidence to exactly three public states.
 *
 * DESIGN COMMITMENTS
 *
 *  1. CONSERVATIVE. TERALIH and TIDAK_HADIR must be EARNED by sustained
 *     evidence. When in doubt the engine reports FOKUS, because a false
 *     "distracted" shown to a 12-15 year old is far more harmful than a missed
 *     one — it teaches the student the tool is wrong and they stop trusting it.
 *
 *  2. FOKUS IS OPERATIONAL, NOT COGNITIVE. It means "present, and no
 *     distraction rule fired". It is NOT a claim that the student is
 *     concentrating. Nothing here can see attention.
 *
 *  3. TRACEABLE. Every TERALIH carries the evidence that caused it
 *     (YAW | PITCH | EYE_CLOSURE | MULTIPLE), so v0.2 replay can audit it.
 *
 *  4. HOLD ON UNCERTAINTY. Momentarily invalid measurement holds the previous
 *     state for a grace period instead of forcing a transition.
 *
 * PRECEDENCE: TIDAK_HADIR > TERALIH > FOKUS.
 * Absence dominates: if there is no face, no head-pose evidence is meaningful.
 */

import { AIState, StateReason } from '../types.js';
import { isFiniteNumber } from '../core/math.js';
import { EvidenceEngine } from './EvidenceEngine.js';

export class StateEngine {
  /**
   * @param {import('../config.js').CONFIG} config
   * @param {EvidenceEngine} evidenceEngine
   */
  constructor(config, evidenceEngine) {
    this.config = config;
    this.evidence = evidenceEngine ?? new EvidenceEngine(config);
    this.reset();
  }

  reset() {
    this.state = AIState.FOKUS;
    this.reason = StateReason.NONE;
    this.activeEvidence = EvidenceEngine.emptyEvidence();
    this.stateSinceMs = null;
    this._pendingState = null;
    this._pendingReason = StateReason.NONE;
    this._pendingSinceMs = null;
    this._lastValidMs = null;
    this._holding = false;
  }

  /**
   * @param {Object} temporal  output of TemporalTracker.update
   * @param {Object} validity  {signalValid, poseValid, calibrationValid}
   * @param {number} nowMs
   * @returns {{state:string, reason:string, stateDurationMs:number, holding:boolean}}
   */
  update(temporal, validity, nowMs) {
    if (this.stateSinceMs === null) this.stateSinceMs = nowMs;

    const target = this._resolveTarget(temporal, validity, nowMs);

    if (target === null) {
      // Uncertain: hold the current state, do not start a debounce.
      this._pendingState = null;
      this._holding = true;
      return this._emit(nowMs);
    }
    this._holding = false;
    // Evidence flags always reflect the CURRENT frame, even while a transition
    // is still debouncing, so telemetry shows why a change is pending.
    this.activeEvidence = target.activeEvidence;

    if (target.state === this.state) {
      // Already there. Keep the reason current (e.g. YAW -> MULTIPLE) without
      // restarting stateDurationMs, which measures time in the STATE.
      this.reason = target.reason;
      this._pendingState = null;
      return this._emit(nowMs);
    }

    // Debounce every transition. STATE_RECOVERY_MS applies symmetrically:
    // it stops flicker both into and out of TERALIH.
    if (this._pendingState !== target.state) {
      this._pendingState = target.state;
      this._pendingReason = target.reason;
      this._pendingSinceMs = nowMs;
    } else {
      this._pendingReason = target.reason;
    }

    const heldMs = nowMs - this._pendingSinceMs;
    if (heldMs >= this._debounceFor(target.state)) {
      this.state = target.state;
      this.reason = target.reason;
      this.stateSinceMs = nowMs;
      this._pendingState = null;
    }

    return this._emit(nowMs);
  }

  /**
   * Decide the state the evidence currently supports.
   *
   * Precedence: TIDAK_HADIR > TERALIH > FOKUS.
   *
   * @returns {{state:string, reason:string, activeEvidence:Object}|null}
   *          null = uncertain, hold the previous state.
   */
  _resolveTarget(temporal, validity, nowMs) {
    // Fuse persisted evidence once; used by both the TERALIH branch and the
    // telemetry emitted on every other branch.
    const fused = this.evidence.decide(temporal.persisted ?? {});

    // ── A. TIDAK_HADIR ── highest precedence.
    // Driven purely by the sustained-absence tracker, so a single missing frame
    // can never land here. When the user cannot be observed, no head-pose or
    // eye evidence is meaningful, so evidence is reported empty.
    if (temporal.faceAbsent) {
      return {
        state: AIState.TIDAK_HADIR,
        reason: StateReason.ABSENCE,
        activeEvidence: EvidenceEngine.emptyEvidence(),
      };
    }

    // Track the last frame on which the signal was usable, for the grace window.
    if (!temporal.faceMissingMs || temporal.faceMissingMs === 0) {
      this._lastValidMs = validity.signalValid ? nowMs : this._lastValidMs;
    }

    // ── Uncertainty hold ──
    // Face is present but measurement is unusable (pose failed / uncalibrated).
    // Within grace, HOLD. We never invent evidence and never coerce a failed
    // pose to 0 degrees.
    if (!validity.signalValid) {
      const graceMs = this.config.validity.SIGNAL_INVALID_GRACE_MS;
      const since = isFiniteNumber(this._lastValidMs)
        ? nowMs - this._lastValidMs
        : Infinity;
      if (since <= graceMs) return null;
      // Grace exhausted. Absent usable measurement we cannot justify TERALIH,
      // so fall back to the conservative default.
      return {
        state: AIState.FOKUS,
        reason: StateReason.NONE,
        activeEvidence: fused.activeEvidence,
      };
    }

    // ── B. TERALIH ── requires sustained STRONG evidence.
    // `fused.diverted` is computed from strong sources only. Support signals
    // (downward pitch, roll) are present in activeEvidence for traceability but
    // cannot make this true — that is the v0.2 guarantee that reading, writing
    // and head-tilt stay FOKUS.
    if (fused.diverted) {
      return {
        state: AIState.TERALIH,
        reason: fused.primaryReason,
        activeEvidence: fused.activeEvidence,
      };
    }

    // ── C. FOKUS ── operational default: present, observable, no strong
    // evidence of behavioural diversion. NOT a claim of cognitive attention.
    return {
      state: AIState.FOKUS,
      reason: StateReason.NONE,
      activeEvidence: fused.activeEvidence,
    };
  }

  /**
   * Debounce duration for entering a given state.
   * Absence already carries its own long FACE_MISSING_ENTER_MS accumulation,
   * so adding the full recovery debounce on top would double-delay it.
   */
  _debounceFor(targetState) {
    if (targetState === AIState.TIDAK_HADIR) return 0;
    return this.config.state.STATE_RECOVERY_MS;
  }

  _emit(nowMs) {
    return {
      state: this.state,
      /** v0.2 name. */
      primaryReason: this.reason,
      /** v0.1 alias, kept so existing consumers keep working. */
      reason: this.reason,
      activeEvidence: { ...this.activeEvidence },
      stateDurationMs: Math.max(0, nowMs - (this.stateSinceMs ?? nowMs)),
      holding: this._holding,
      pendingState: this._pendingState,
    };
  }
}

export default StateEngine;
