/**
 * HACHIKO — Debug Verification verdict evaluator  (tools/debug)
 * ============================================================
 * THE single authority on what a Debug Verification trial PROVED. The UI, the
 * exporter and the report generator all read this output; none of them scores
 * a scenario independently.
 *
 *   bounded samples -> evaluateDebugTrial() -> summary -> JSON -> XLSX
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────
 * The verdict used to be `publicState !== 'FOKUS'` at some point in the window.
 * That reads the DISPLAY layer, not the pipeline under test. A real D01 dry-run
 * produced yaw strong evidence for ~500 ms, then relaxed; the public state never
 * changed, so the trial reported "no trigger" and scored PASS — while the raw
 * telemetry plainly showed `yawEvidence = true`. A verification harness that
 * grades the wrong layer cannot be used as evidence.
 *
 * So a verdict here derives from THREE things, over the WHOLE bounded window:
 *   1. scenario-specific signal validity (was this trial evaluable at all?)
 *   2. scenario-specific evidence behaviour (what did the relevant rule do?)
 *   3. temporal behaviour (did it activate at ANY valid point, not just last?)
 *
 * ── WHAT THIS MODULE DOES NOT DO ─────────────────────────────────────────
 * It changes NO threshold, NO persistence constant, NO calibration, and neither
 * EvidenceEngine nor StateEngine. It only reads telemetry those produced.
 *
 * It is deliberately allowed to report
 *   "Verification failed: yaw strong evidence activated"
 * on a trial whose public state stayed FOKUS. If evidence and public state
 * disagree, that is a finding to investigate in state routing — not something
 * this evaluator should paper over by trusting the friendlier of the two.
 *
 * ── THRESHOLDS ARE READ, NEVER RESTATED ──────────────────────────────────
 * "Did the operator actually perform the challenge?" needs a numeric criterion.
 * Every one is read from CONFIG.state, so this file introduces no second copy
 * of a threshold that could rot when the engine changes.
 */

import { CONFIG } from '../../src/ai/index.js';

const S = CONFIG.state;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Canonical direction sign, read from the pose convention rather than assumed.
 *
 * `yaw > 0` means the subject turned to THEIR OWN LEFT. HeadPoseExtractor has
 * already applied `invertYaw`, so deltas reaching telemetry are canonical and
 * no comparison here may re-compensate for a device's raw axis direction.
 */
export const YAW_LEFT_SIGN = +1;
export const YAW_RIGHT_SIGN = -1;

/** Verdicts a trial can carry. */
export const TrialVerdict = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  INVALID: 'INVALID',
});

/**
 * Evidence channels, split by TIER because the tiers are structural.
 * STRONG evidence can justify a distraction conclusion on its own; SUPPORT
 * cannot. A scenario that forbids "strong evidence" is not also forbidding a
 * support cue, and conflating them would make D06/D07/D11 unpassable.
 */
const STRONG_CHANNELS = Object.freeze({
  yaw: { flag: 'yawEvidence', persist: 'yawPersistenceMs', label: 'Yaw' },
  pitchUp: { flag: 'pitchUpEvidence', persist: 'pitchPersistenceMs', label: 'Pitch-up' },
  eyeClosure: { flag: 'eyeClosureEvidence', persist: 'eyePersistenceMs',
    label: 'Sustained eye closure' },
});
const SUPPORT_CHANNELS = Object.freeze({
  pitchDown: { flag: 'pitchDownSupport', label: 'Pitch-down support' },
  headTilt: { flag: 'rollSupport', label: 'Head-tilt support' },
});

/**
 * Did this channel activate at ANY point in the window, and when?
 *
 * Window-wide by construction: reading the final sample is what produced the
 * false PASS this module exists to fix.
 */
function channelActivity(samples, chan) {
  let firstIdx = -1;
  let activeCount = 0;
  let maxPersistenceMs = null;

  samples.forEach((x, i) => {
    if (x[chan.flag] === true) {
      if (firstIdx < 0) firstIdx = i;
      activeCount += 1;
    }
    if (chan.persist && finite(x[chan.persist])) {
      maxPersistenceMs = Math.max(maxPersistenceMs ?? 0, x[chan.persist]);
    }
  });

  return {
    everActive: firstIdx >= 0,
    firstActivationMs: firstIdx >= 0
      ? (samples[firstIdx].relativeTimeMs ?? null) : null,
    activeSampleCount: activeCount,
    maxPersistenceMs,
  };
}

function instantaneousActivity(samples, flag) {
  let firstIdx = -1;
  let activeCount = 0;
  samples.forEach((x, i) => {
    if (x[flag] === true) {
      if (firstIdx < 0) firstIdx = i;
      activeCount += 1;
    }
  });
  return {
    everActive: firstIdx >= 0,
    firstActivationMs: firstIdx >= 0
      ? (samples[firstIdx].relativeTimeMs ?? null) : null,
    activeSampleCount: activeCount,
  };
}

/** Every channel's activity, keyed by channel name. */
function allActivity(samples) {
  const strong = {};
  for (const [k, c] of Object.entries(STRONG_CHANNELS)) {
    strong[k] = channelActivity(samples, c);
  }
  const support = {};
  for (const [k, c] of Object.entries(SUPPORT_CHANNELS)) {
    support[k] = channelActivity(samples, c);
  }
  return { strong, support };
}

/** Which STRONG channels fired, as human labels. */
const strongFired = (act) => Object.entries(act.strong)
  .filter(([, a]) => a.everActive)
  .map(([k]) => STRONG_CHANNELS[k].label);

/**
 * Peak signed deviation over samples whose pose was usable.
 *
 * Only usable samples count: a deviation reported while the pose was invalid
 * is not a measurement of the operator's head, so it cannot demonstrate that a
 * challenge was performed.
 */
function peakSigned(samples, key, sign) {
  let peak = null;
  for (const x of samples) {
    if (!x.headPoseValid || !finite(x[key])) continue;
    const v = x[key] * sign;          // positive = the direction we asked for
    if (peak === null || v > peak) peak = v;
  }
  return peak;
}

/** Deepest relative-EAR dip while the eye signal was eligible. */
function minEligibleEar(samples) {
  let lo = null;
  for (const x of samples) {
    if (x.eyeEligible !== true || !finite(x.earRelative)) continue;
    if (lo === null || x.earRelative < lo) lo = x.earRelative;
  }
  return lo;
}

/**
 * Did the operator actually perform the challenge this scenario asks for?
 *
 * This is what separates INVALID from PASS on the "must NOT latch" scenarios.
 * A motionless D04 trial trivially satisfies "evidence never activated" while
 * proving nothing about persistence, so it must not be scored PASS.
 * Every criterion below is a CONFIG threshold, never a new number.
 */
function challenge(scenarioId, samples) {
  switch (scenarioId) {
    case 'YAW_LEFT_SUSTAINED': {
      const peak = peakSigned(samples, 'yawDelta', YAW_LEFT_SIGN);
      const opposite = peakSigned(samples, 'yawDelta', YAW_RIGHT_SIGN);
      return { performed: finite(peak) && peak >= S.STRONG_YAW_DELTA_DEG,
        peakDeg: peak, oppositeDeg: opposite,
        criterion: `yaw ≥ ${S.STRONG_YAW_DELTA_DEG}° toward the asked side` };
    }
    case 'BRIEF_YAW_GLANCE': {
      // DIRECTION-AGNOSTIC on purpose. D04 tests PERSISTENCE, not laterality —
      // D02 and D03 already own direction. Requiring one side here would mark
      // a perfectly valid right-hand glance as "challenge not performed", which
      // is what the pilot hit.
      // The challenge stage now matches runtime yaw evidence: instantaneous
      // yawStrong, computed from smoothed calibrated yaw by EvidenceEngine.
      const cue = instantaneousActivity(samples, 'yawInstantaneous');
      const runtimePeak = Math.max(...samples
        .filter((x) => x.yawInstantaneous === true && finite(x.yawSmoothed))
        .map((x) => Math.abs(x.yawSmoothed)), -Infinity);
      return {
        performed: cue.everActive,
        peakDeg: Number.isFinite(runtimePeak) ? runtimePeak : null,
        firstCueMs: cue.firstActivationMs,
        criterion: `instantaneous yaw cue from smoothed |yaw| > ${S.STRONG_YAW_DELTA_DEG}°`,
      };
    }
    case 'YAW_RIGHT_SUSTAINED': {
      const peak = peakSigned(samples, 'yawDelta', YAW_RIGHT_SIGN);
      const opposite = peakSigned(samples, 'yawDelta', YAW_LEFT_SIGN);
      return { performed: finite(peak) && peak >= S.STRONG_YAW_DELTA_DEG,
        peakDeg: peak, oppositeDeg: opposite,
        criterion: `yaw ≥ ${S.STRONG_YAW_DELTA_DEG}° toward the asked side` };
    }
    case 'PITCH_UP_SUSTAINED': {
      const peak = peakSigned(samples, 'pitchDelta', +1);
      return { performed: finite(peak) && peak >= S.STRONG_UP_PITCH_DELTA_DEG,
        peakDeg: peak,
        criterion: `pitch-up ≥ ${S.STRONG_UP_PITCH_DELTA_DEG}°` };
    }
    case 'PITCH_DOWN_STUDY_LIKE': {
      const peak = peakSigned(samples, 'pitchDelta', -1);
      return { performed: finite(peak) && peak >= S.DOWN_PITCH_SUPPORT_DEG,
        peakDeg: peak,
        criterion: `pitch-down ≥ ${S.DOWN_PITCH_SUPPORT_DEG}°` };
    }
    case 'HEAD_TILT': {
      const peak = Math.max(peakSigned(samples, 'rollDelta', +1) ?? -Infinity,
        peakSigned(samples, 'rollDelta', -1) ?? -Infinity);
      const ok = finite(peak) && peak >= S.ROLL_SUPPORT_DEG;
      return { performed: ok, peakDeg: finite(peak) ? peak : null,
        criterion: `head tilt ≥ ${S.ROLL_SUPPORT_DEG}°` };
    }
    case 'NORMAL_BLINK': {
      // A blink is an EAR dip below the closure condition that does not last.
      // The closure THRESHOLD is the criterion; persistence is what must fail.
      const lo = minEligibleEar(samples);
      return { performed: finite(lo) && lo <= S.EAR_RELATIVE_THRESHOLD,
        minEar: lo,
        criterion: `relative EAR ≤ ${S.EAR_RELATIVE_THRESHOLD} at least once` };
    }
    case 'SUSTAINED_EYE_CLOSURE': {
      const lo = minEligibleEar(samples);
      return { performed: finite(lo) && lo <= S.EAR_RELATIVE_THRESHOLD,
        minEar: lo,
        criterion: `relative EAR ≤ ${S.EAR_RELATIVE_THRESHOLD}` };
    }
    default:
      // D01, D10 and D11 have no single numeric challenge: D01 asks for the
      // ABSENCE of action, D10 is judged by its dropout sequence, and D11 is a
      // realistic-behaviour probe whose posture is not prescribed.
      return { performed: true, criterion: null };
  }
}

/**
 * D10's temporal sequence: valid signal, then genuine dropout, then recovery.
 *
 * Judged on face/behaviour signal availability rather than on public state,
 * and an intentional invalid stretch is the measurement here, not a defect.
 */
function dropoutSequence(samples) {
  const usable = samples.map(
    (x) => x.faceDetected === true && x.stateSignalValid === true);

  const firstValid = usable.indexOf(true);
  if (firstValid < 0) {
    return { ok: false, reason: 'No usable signal before the dropout' };
  }
  const dropAt = usable.indexOf(false, firstValid);
  if (dropAt < 0) {
    return { ok: false, reason: 'No signal dropout occurred' };
  }
  const recoverAt = usable.indexOf(true, dropAt);
  if (recoverAt < 0) {
    return { ok: false, reason: 'Signal never recovered before the trial ended' };
  }
  return {
    ok: true,
    reason: null,
    dropoutStartMs: samples[dropAt].relativeTimeMs ?? null,
    recoveryMs: samples[recoverAt].relativeTimeMs ?? null,
    dropoutSampleCount: usable.slice(dropAt, recoverAt).filter((v) => !v).length,
  };
}

/**
 * Was any face-dependent evidence asserted while its own signal was invalid?
 *
 * D10's real claim: nothing is fabricated during the dropout.
 */
function fabricatedDuringDropout(samples) {
  // Production HOLDs state for SIGNAL_INVALID_GRACE_MS after the signal goes
  // bad (StateEngine: "Within grace, HOLD"), so evidence that was already
  // active when the signal died legitimately persists for a moment. That is
  // carry-through, not fabrication, and flagging it made honest D10 runs fail.
  //
  // The real violation is evidence that appears FROM NOTHING while the signal
  // is unusable: inactive before the dropout, active during it.
  const grace = CONFIG.validity?.SIGNAL_INVALID_GRACE_MS ?? 0;
  const CHANNELS = [
    { flag: 'yawEvidence',
      dead: (x) => x.faceDetected !== true || x.headPoseValid !== true },
    { flag: 'pitchUpEvidence',
      dead: (x) => x.faceDetected !== true || x.headPoseValid !== true },
    { flag: 'eyeClosureEvidence',
      dead: (x) => x.faceDetected !== true || x.eyeEligible !== true },
  ];

  for (const c of CHANNELS) {
    let lastLiveMs = null;      // when this channel's signal was last usable
    let activeWhenLost = false; // was it already firing at that moment?

    for (const x of samples) {
      const t = finite(x.relativeTimeMs) ? x.relativeTimeMs : null;
      if (!c.dead(x)) {
        lastLiveMs = t;
        activeWhenLost = x[c.flag] === true;
        continue;
      }
      if (x[c.flag] !== true) continue;

      // Firing while the signal is dead. Acceptable only as carry-through:
      // it must have been active when the signal was lost, AND still be
      // inside the configured grace.
      const since = (t !== null && lastLiveMs !== null) ? t - lastLiveMs : Infinity;
      if (!activeWhenLost || since > grace) return true;
    }
  }
  return false;
}

/** PASS shorthand. */
const pass = (observed, detail) => ({
  verdict: TrialVerdict.PASS, observedOutcome: observed,
  failureReason: null, ...detail });
/** FAIL shorthand — the scenario was evaluable and the behaviour was wrong. */
const fail = (observed, reason, detail) => ({
  verdict: TrialVerdict.FAIL, observedOutcome: observed,
  failureReason: reason, ...detail });
/** INVALID shorthand — the scenario could not be judged. */
const invalid = (observed, reason, detail) => ({
  verdict: TrialVerdict.INVALID, observedOutcome: observed,
  failureReason: reason, ...detail });

/**
 * "No strong evidence may activate" — the shared shape of D01/D04/D06/D07/
 * D08/D11. Support cues are explicitly allowed.
 */
function requireNoStrongEvidence(act, okText) {
  const fired = strongFired(act);
  if (fired.length) {
    const first = Object.entries(act.strong)
      .filter(([, a]) => a.everActive)
      .sort((a, b) => (a[1].firstActivationMs ?? 0) - (b[1].firstActivationMs ?? 0))[0];
    const label = STRONG_CHANNELS[first[0]].label;
    return fail(`${label} strong evidence activated`,
      `Unexpected ${label.toLowerCase()} evidence after persistence`);
  }
  return pass(okText);
}

/** Per-scenario semantics. Each returns {verdict, observedOutcome, failureReason}. */
function judge(scenarioId, samples, act) {
  const ch = challenge(scenarioId, samples);

  switch (scenarioId) {
    // ── D01: neutral must not manufacture strong evidence ──
    case 'NEUTRAL_FRONTAL':
      return requireNoStrongEvidence(act, 'No strong evidence activated');

    // ── D02 / D03: sustained yaw must activate, in the asked direction ──
    case 'YAW_LEFT_SUSTAINED':
    case 'YAW_RIGHT_SUSTAINED': {
      const side = scenarioId === 'YAW_LEFT_SUSTAINED' ? 'left' : 'right';
      if (!ch.performed) {
        // Turning the WRONG way is a mis-run, not a pipeline defect.
        if (finite(ch.oppositeDeg) && ch.oppositeDeg >= S.STRONG_YAW_DELTA_DEG) {
          return invalid(`Yaw challenge performed toward the opposite side`,
            `Scenario asks for ${side} yaw; the observed turn was the other way`);
        }
        return invalid('Yaw challenge not performed',
          `No sustained ${side} yaw reached ${ch.criterion}`);
      }
      if (!act.strong.yaw.everActive) {
        return fail('Yaw threshold crossed; evidence never activated',
          'Yaw persistence did not complete despite a sustained turn');
      }
      return pass('Yaw strong evidence activated');
    }

    // ── D04: crossing without duration must NOT latch ──
    case 'BRIEF_YAW_GLANCE': {
      if (!ch.performed) {
        // A motionless trial proves nothing about persistence.
        return invalid('No yaw challenge performed',
          `The glance never reached ${ch.criterion}, so persistence was not tested`);
      }
      if (act.strong.yaw.everActive) {
        return fail('Yaw strong evidence activated',
          'A brief glance completed yaw persistence');
      }
      return pass('Yaw threshold crossed; persistence did not complete');
    }

    // ── D05: sustained pitch-up must activate ──
    case 'PITCH_UP_SUSTAINED': {
      if (!ch.performed) {
        return invalid('Pitch-up challenge not performed',
          `No sustained pitch-up reached ${ch.criterion}`);
      }
      if (!act.strong.pitchUp.everActive) {
        return fail('Pitch-up threshold crossed; evidence never activated',
          'Pitch-up persistence did not complete despite a sustained pose');
      }
      return pass('Pitch-up strong evidence activated');
    }

    // ── D06: pitch-down is SUPPORT, never strong on its own ──
    case 'PITCH_DOWN_STUDY_LIKE': {
      if (!ch.performed) {
        return invalid('Pitch-down challenge not performed',
          `No study-like downward pose reached ${ch.criterion}`);
      }
      const r = requireNoStrongEvidence(act,
        act.support.pitchDown.everActive
          ? 'Support evidence only; no strong evidence'
          : 'No strong evidence activated');
      return r;
    }

    // ── D07: head tilt is SUPPORT, never strong on its own ──
    case 'HEAD_TILT': {
      if (!ch.performed) {
        return invalid('Head-tilt challenge not performed',
          `No head tilt reached ${ch.criterion}`);
      }
      return requireNoStrongEvidence(act,
        act.support.headTilt.everActive
          ? 'Support evidence only; no strong evidence'
          : 'No strong evidence activated');
    }

    // ── D08: a blink is not a sustained closure ──
    case 'NORMAL_BLINK': {
      if (!ch.performed) {
        return invalid('No blink-like closure observed',
          `Relative EAR never reached ${ch.criterion}, so closure was not tested`);
      }
      if (act.strong.eyeClosure.everActive) {
        return fail('Sustained eye closure evidence activated',
          'Normal blinking completed eye-closure persistence');
      }
      return pass('Blinks observed; closure evidence did not latch');
    }

    // ── D09: sustained closure must activate ──
    case 'SUSTAINED_EYE_CLOSURE': {
      if (!ch.performed) {
        return invalid('Eye-closure challenge not performed',
          `Relative EAR never reached ${ch.criterion} under an eligible pose`);
      }
      if (!act.strong.eyeClosure.everActive) {
        return fail('EAR crossed the closure condition; evidence never activated',
          'Eye-closure persistence did not complete');
      }
      return pass('Sustained eye-closure evidence activated');
    }

    // ── D10: valid -> dropout -> recovery, inventing nothing in between ──
    case 'FACE_DROPOUT_RECOVERY': {
      const seq = dropoutSequence(samples);
      if (!seq.ok) return invalid('Dropout sequence incomplete', seq.reason);
      if (fabricatedDuringDropout(samples)) {
        return fail('Evidence asserted while its signal was invalid',
          'Face-dependent evidence was active without a usable signal');
      }
      return pass('Signal dropout followed by recovery');
    }

    // ── D11: realistic study posture must not be promoted to distraction ──
    case 'READING_WRITING':
      return requireNoStrongEvidence(act,
        (act.support.pitchDown.everActive || act.support.headTilt.everActive)
          ? 'Study-compatible support cues only'
          : 'No strong evidence activated');

    default:
      return invalid('Unknown scenario', `No verdict rules for "${scenarioId}"`);
  }
}

/**
 * Evaluate one bounded Debug Verification trial.
 *
 * @param {Object}   args
 * @param {Object}   args.scenario  registry entry (D01–D11)
 * @param {Array}    args.samples   the bounded window, as captured
 * @param {Object}   args.validity  output of `evaluateTrialValidity()`
 * @returns {{trialVerdict: string, observedOutcome: string,
 *            observedTrigger: boolean, matchesExpectation: boolean|null,
 *            failureReason: string|null, verificationDetails: Object}}
 */
export function evaluateDebugTrial({ scenario, samples, validity }) {
  const s = samples ?? [];
  const act = allActivity(s);
  const anyStrong = strongFired(act);

  // Signal validity gates everything: a trial whose required signal was
  // unusable cannot PASS by virtue of nothing having fired. That is an absent
  // measurement, not a correct negative.
  const signalOk = validity?.trialValidity === 'VALID';

  const outcome = signalOk
    ? judge(scenario?.id, s, act)
    : invalid('Required signal unusable',
      validity?.trialValidityReason ?? 'Trial validity gate not satisfied');

  const details = {
    // Window-wide activation facts, the evidence behind the verdict.
    yawEverActive: act.strong.yaw.everActive,
    pitchUpEverActive: act.strong.pitchUp.everActive,
    eyeClosureEverActive: act.strong.eyeClosure.everActive,
    pitchDownSupportEverActive: act.support.pitchDown.everActive,
    headTiltSupportEverActive: act.support.headTilt.everActive,
    firstStrongActivationMs: Object.values(act.strong)
      .filter((a) => a.everActive)
      .map((a) => a.firstActivationMs)
      .sort((a, b) => (a ?? 0) - (b ?? 0))[0] ?? null,
    strongActiveSampleCount: Object.values(act.strong)
      .reduce((n, a) => n + a.activeSampleCount, 0),
    maxYawPersistenceMs: act.strong.yaw.maxPersistenceMs,
    maxPitchUpPersistenceMs: act.strong.pitchUp.maxPersistenceMs,
    maxEyeClosurePersistenceMs: act.strong.eyeClosure.maxPersistenceMs,
    challenge: challenge(scenario?.id, s),
  };
  if (scenario?.id === 'FACE_DROPOUT_RECOVERY') {
    details.dropout = dropoutSequence(s);
  }

  return {
    trialVerdict: outcome.verdict,
    observedOutcome: outcome.observedOutcome,
    // "A strong rule fired somewhere in this window" — window-wide, and
    // independent of whether the public state ever changed.
    observedTrigger: anyStrong.length > 0,
    failureReason: outcome.failureReason,
    matchesExpectation: outcome.verdict === TrialVerdict.INVALID
      ? null : outcome.verdict === TrialVerdict.PASS,
    verificationDetails: details,
  };
}
