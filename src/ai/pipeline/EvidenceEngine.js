/**
 * HACHIKO AI v0.2 — EvidenceEngine
 * ================================
 * Turns sustained temporal signals into TIERED, TRACEABLE evidence.
 *
 * This module exists so that "what counts as evidence" lives in exactly one
 * place, separate from both measurement (upstream) and the state decision
 * (downstream). Changing the rules later means editing this file only.
 *
 * ── THE TIER MODEL ────────────────────────────────────────────────────────
 *
 * v0.1 collapsed everything into `yaw OR pitch OR eyeClosure -> TERALIH`. That
 * is wrong because the features are not behaviourally equivalent:
 *
 *   STRONG  — may INDEPENDENTLY produce TERALIH once persisted.
 *             yaw, upward pitch, long eye closure.
 *
 *   SUPPORT — may NEVER independently produce TERALIH, no matter how large or
 *             how long. Measured, logged, exposed, and usable to corroborate,
 *             but alone it always resolves to FOKUS.
 *             downward pitch, roll.
 *
 * ── WHY DOWNWARD PITCH AND ROLL ARE SUPPORT-ONLY ─────────────────────────
 *
 * Downward pitch is what reading a book, writing in a notebook, and looking at
 * notes all look like. README-deteksi-hachiko.md section 3 names this as the
 * known blind spot of pure head-pose systems. Replaying the historical Python
 * log through this engine confirmed it empirically: reading (`baca_buku`) was
 * flagged MORE often than phone use (`pegang_hp`), 31.1% vs 24.8%. A system
 * that fires on head-down punishes exactly the behaviour it should reward.
 *
 * Roll is ordinary posture — resting on a hand, leaning, relaxing.
 *
 * Upward pitch is treated as strong because, at a desk, sustained looking-up
 * has no comparable study-compatible explanation.
 *
 * ── ENFORCEMENT ───────────────────────────────────────────────────────────
 *
 * The tier is structural, not conventional. Support signals are returned in a
 * separate `support` object that `decide()` never reads when choosing a state,
 * and StateReason has no PITCH_DOWN or ROLL member, so a support signal cannot
 * be named as a primary reason even by mistake.
 */

import { StateReason, EvidenceTier } from '../types.js';

/** Immutable description of every evidence source, for docs and telemetry. */
export const EVIDENCE_SOURCES = Object.freeze({
  yawStrong: Object.freeze({
    tier: EvidenceTier.STRONG, reason: StateReason.YAW,
    describes: 'sustained large horizontal head turn',
  }),
  pitchUpStrong: Object.freeze({
    tier: EvidenceTier.STRONG, reason: StateReason.PITCH_UP,
    describes: 'sustained large upward head pitch',
  }),
  eyeClosureStrong: Object.freeze({
    tier: EvidenceTier.STRONG, reason: StateReason.EYE_CLOSURE,
    describes: 'sustained eye closure beyond blink/thinking duration',
  }),
  pitchDownSupport: Object.freeze({
    tier: EvidenceTier.SUPPORT, reason: null,
    describes: 'sustained downward pitch — reading/writing/notes; never a trigger',
  }),
  rollSupport: Object.freeze({
    tier: EvidenceTier.SUPPORT, reason: null,
    describes: 'sustained head tilt — ordinary posture; never a trigger',
  }),
});

/** Strong sources in fixed precedence order, used to pick a primary reason. */
const STRONG_ORDER = ['yawStrong', 'pitchUpStrong', 'eyeClosureStrong'];

export class EvidenceEngine {
  /** @param {import('../config.js').CONFIG} config */
  constructor(config) {
    this.config = config;
  }

  /**
   * Is EAR trustworthy enough this frame to contribute EYE_CLOSURE evidence?
   *
   * EAR is a projected 2D ratio and collapses as the head turns away, even
   * with the eyes fully open (real Gate-1: 0.220 while open, looking down).
   * This gate keeps EAR measured and logged always, but lets it drive evidence
   * only at near-frontal geometry where the ratio is meaningful.
   *
   * Operates on CANONICAL pose deltas — see config.headPose.
   *
   * @param {Object} input
   * @param {boolean} input.poseValid
   * @param {number|null} input.yawDelta    canonical, degrees from baseline
   * @param {number|null} input.pitchDelta  canonical, degrees from baseline
   * @param {number|null} input.earLeft
   * @param {number|null} input.earRight
   * @param {number|null} input.earMean
   * @returns {{eligible:boolean, reason:string}}
   */
  evaluateEyeEligibility(input) {
    const g = this.config.eye.eligibility;
    const finite = (v) => typeof v === 'number' && Number.isFinite(v);

    if (!input.poseValid) return { eligible: false, reason: 'POSE_INVALID' };

    // Without a calibrated pose we cannot know how far from frontal we are, so
    // we refuse rather than assume frontal.
    if (!finite(input.yawDelta) || !finite(input.pitchDelta)) {
      return { eligible: false, reason: 'POSE_DELTA_UNAVAILABLE' };
    }
    if (Math.abs(input.yawDelta) > g.EYE_MAX_ABS_YAW_DEG) {
      return { eligible: false, reason: 'YAW_OUT_OF_RANGE' };
    }
    if (Math.abs(input.pitchDelta) > g.EYE_MAX_ABS_PITCH_DEG) {
      return { eligible: false, reason: 'PITCH_OUT_OF_RANGE' };
    }

    // Both eyes must be measurable.
    if (!finite(input.earLeft) || !finite(input.earRight) || !finite(input.earMean)) {
      return { eligible: false, reason: 'EAR_UNAVAILABLE' };
    }

    // MEASUREMENT VALIDITY — deliberately NOT a physiological floor.
    //
    // Only IMPOSSIBLE values are rejected: negative (geometrically meaningless)
    // or above the upper bound (no real eye is that open — a bad landmark
    // solve). A near-zero EAR is not implausible; it is precisely what a closed
    // eye measures. A real Gate-1 closure read L=0.016 R=0.016 and was wrongly
    // rejected by a 0.02 physiological floor, so closure could never fire.
    //
    // Whether a VALID low reading counts as closure is a separate question,
    // answered later by EAR_RELATIVE_THRESHOLD. Validity != classification.
    for (const v of [input.earLeft, input.earRight]) {
      if (v < g.EYE_MIN_VALID_EAR || v > g.EYE_MAX_PLAUSIBLE_EAR) {
        return { eligible: false, reason: 'EAR_IMPLAUSIBLE' };
      }
    }

    // Left/right agreement: a large asymmetry means one eye is occluded or
    // foreshortened, so the mean does not describe either eye.
    //
    // Skipped when BOTH eyes are near zero. The ratio is unstable there — two
    // genuinely shut eyes at 0.005 and 0.016 differ by 0.011 yet give a 3.2x
    // ratio — so bilateral near-zero counts as agreement, not disagreement.
    // One eye above the floor and one below is still checked: that is the real
    // one-eye-occluded case.
    if (g.enableLrConsistencyCheck) {
      const hi = Math.max(input.earLeft, input.earRight);
      const lo = Math.min(input.earLeft, input.earRight);
      const bothNearZero = hi < g.EYE_LR_RATIO_MIN_EAR;
      if (!bothNearZero && lo > 0 && hi / lo > g.EYE_MAX_LR_RATIO) {
        return { eligible: false, reason: 'EAR_ASYMMETRIC' };
      }
      // A zero/near-zero eye paired with a clearly open one is asymmetric.
      if (!bothNearZero && lo <= 0) {
        return { eligible: false, reason: 'EAR_ASYMMETRIC' };
      }
    }

    return { eligible: true, reason: 'NONE' };
  }

  /**
   * Evaluate instantaneous threshold crossings.
   *
   * Returns raw (unpersisted) conditions; TemporalTracker owns persistence.
   * Directionality is applied HERE — this is the only place that knows
   * upward pitch differs from downward pitch. It reads CANONICAL values, so it
   * never compensates for a device's raw axis direction.
   *
   * @param {Object} signals smoothed, calibrated values (may contain nulls)
   * @param {boolean} usable face present AND signal valid
   * @returns {{strong:Object, support:Object, eyeEligible:boolean, eyeIneligibleReason:string}}
   */
  evaluateInstantaneous(signals, usable) {
    const s = this.config.state;
    const finite = (v) => typeof v === 'number' && Number.isFinite(v);
    const { yawSmoothed, pitchSmoothed, rollSmoothed, earSmoothed } = signals;

    // Yaw is non-directional: left and right are equally diverting.
    const yaw = usable && s.enableYawEvidence && finite(yawSmoothed)
      && Math.abs(yawSmoothed) > s.STRONG_YAW_DELTA_DEG;

    // Pitch IS directional. Positive = up (see docs/HEAD_POSE_CONVENTION.md).
    // Note these use `> +threshold` and `< -threshold`, NOT Math.abs — that
    // asymmetry is the entire point.
    const pitchUp = usable && s.enablePitchUpEvidence && finite(pitchSmoothed)
      && pitchSmoothed > s.STRONG_UP_PITCH_DELTA_DEG;

    const pitchDown = usable && s.enableDownPitchSupport && finite(pitchSmoothed)
      && pitchSmoothed < -s.DOWN_PITCH_SUPPORT_DEG;

    const roll = usable && s.enableRollSupport && finite(rollSmoothed)
      && Math.abs(rollSmoothed) > s.ROLL_SUPPORT_DEG;

    // Eye closure: earRelative below threshold means the eye is more closed
    // than this person's own calibrated baseline.
    //
    // GATED BY GEOMETRY. `eyeEvidenceEligible` is evaluated on the raw
    // (unsmoothed) per-frame values so eligibility tracks the head's actual
    // position rather than lagging behind it — a smoothed pose would keep EAR
    // "eligible" for a fraction of a second after the head has already turned
    // away. When ineligible we pass `false`, and TemporalTracker's timer is
    // additionally hard-reset so no partial accumulation survives.
    const eligibility = this.evaluateEyeEligibility({
      poseValid: !!signals.poseValid,
      yawDelta: signals.yawDelta,
      pitchDelta: signals.pitchDelta,
      earLeft: signals.earLeft,
      earRight: signals.earRight,
      earMean: signals.earMean,
    });
    const eyeEligible = usable && eligibility.eligible;

    const eye = eyeEligible && s.enableEyeClosureEvidence && finite(earSmoothed)
      && earSmoothed < s.EAR_RELATIVE_THRESHOLD;

    return {
      strong: { yawStrong: yaw, pitchUpStrong: pitchUp, eyeClosureStrong: eye },
      support: { pitchDownSupport: pitchDown, rollSupport: roll },
      eyeEligible,
      eyeIneligibleReason: usable ? eligibility.reason : 'SIGNAL_UNUSABLE',
    };
  }

  /**
   * Fuse PERSISTED evidence into a state decision.
   *
   * @param {Object} persisted sustained flags from TemporalTracker
   * @returns {{diverted:boolean, primaryReason:string, activeEvidence:Object,
   *            strongCount:number, supportCount:number}}
   */
  decide(persisted) {
    const activeEvidence = {
      yawStrong: !!persisted.yawStrong,
      pitchUpStrong: !!persisted.pitchUpStrong,
      eyeClosureStrong: !!persisted.eyeClosureStrong,
      pitchDownSupport: !!persisted.pitchDownSupport,
      rollSupport: !!persisted.rollSupport,
    };

    // ONLY strong sources are consulted for the decision. Support flags are
    // deliberately not read here — they exist for telemetry and corroboration.
    const firing = STRONG_ORDER.filter((k) => activeEvidence[k]);

    let primaryReason = StateReason.NONE;
    if (firing.length === 1) {
      primaryReason = EVIDENCE_SOURCES[firing[0]].reason;
    } else if (firing.length > 1) {
      primaryReason = StateReason.MULTIPLE;
    }

    return {
      diverted: firing.length > 0,
      primaryReason,
      activeEvidence,
      strongCount: firing.length,
      supportCount:
        (activeEvidence.pitchDownSupport ? 1 : 0) +
        (activeEvidence.rollSupport ? 1 : 0),
    };
  }

  /** All-false evidence, for absence / calibration / uncertain frames. */
  static emptyEvidence() {
    return {
      yawStrong: false, pitchUpStrong: false, eyeClosureStrong: false,
      pitchDownSupport: false, rollSupport: false,
    };
  }
}

export default EvidenceEngine;
