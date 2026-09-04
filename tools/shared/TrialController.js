/**
 * HACHIKO — Trial lifecycle controller  (tools/shared)
 * ====================================================
 * Shared by the Debug Harness and the Bake-off so both pages have ONE
 * definition of "what counts as recorded experiment data".
 *
 * ── THE RULE THIS EXISTS TO ENFORCE ──────────────────────────────────────
 * STARTING THE CAMERA IS NOT STARTING A RECORDING.
 *
 * Live inference may run continuously for developer observation, but a sample
 * belongs to a trial only if its timestamp falls inside
 * [recordingStartedAt, recordingEndedAt]. Countdown frames, preparation
 * frames and post-trial frames are ephemeral and must never reach the
 * experiment record — otherwise the ground-truth label describes a window that
 * includes footage of the operator getting ready, which silently corrupts the
 * dataset.
 *
 * Lifecycle:
 *   CAMERA_OFF -> CAMERA_READY -> SCENARIO_SELECTED -> COUNTDOWN
 *              -> RECORDING -> SAVING -> RECORDED -> CAMERA_READY
 *
 * Pure with respect to I/O: no DOM, no camera, no timers of its own. The page
 * drives it by calling `tick(nowMs)`, which keeps the whole state machine
 * deterministic and unit-testable.
 */

export const TrialState = Object.freeze({
  CAMERA_OFF: 'CAMERA_OFF',
  CAMERA_READY: 'CAMERA_READY',
  SCENARIO_SELECTED: 'SCENARIO_SELECTED',
  COUNTDOWN: 'COUNTDOWN',
  RECORDING: 'RECORDING',
  SAVING: 'SAVING',
  RECORDED: 'RECORDED',
});

/** Human-readable status line for the sticky header. */
export function statusLabel(state, ctx = {}) {
  switch (state) {
    case TrialState.CAMERA_OFF: return 'CAMERA OFF';
    case TrialState.CAMERA_READY: return 'CAMERA ON — NOT RECORDING';
    case TrialState.SCENARIO_SELECTED:
      return `READY — ${ctx.scenarioId ?? 'scenario selected'}`;
    case TrialState.COUNTDOWN:
      return `COUNTDOWN ${Math.max(1, Math.ceil((ctx.remainingMs ?? 0) / 1000))}…`;
    case TrialState.RECORDING:
      return `RECORDING ${((ctx.elapsedMs ?? 0) / 1000).toFixed(1)}`
        + ` / ${((ctx.durationMs ?? 0) / 1000).toFixed(1)} s`;
    case TrialState.SAVING: return 'SAVING…';
    case TrialState.RECORDED:
      return `RECORDED — ${ctx.scenarioId ?? ''} ${ctx.repetition ?? ''}`;
    default: return String(state);
  }
}

export class TrialController {
  /**
   * @param {Object} [options]
   * @param {number} [options.requiredRepetitions=3]
   * @param {(info:Object)=>void} [options.onStateChange]
   * @param {(trial:Object)=>void} [options.onTrialComplete]
   */
  constructor(options = {}) {
    this.requiredRepetitions = options.requiredRepetitions ?? 3;
    this.onStateChange = options.onStateChange ?? (() => {});
    this.onTrialComplete = options.onTrialComplete ?? (() => {});
    this.reset();
  }

  reset() {
    this.state = TrialState.CAMERA_OFF;
    this.scenario = null;
    this.countdownStartedAt = null;
    this.recordingStartedAt = null;
    this.recordingEndedAt = null;
    this.currentTrialId = null;
    this.currentRepetition = null;
    /** Samples collected strictly inside the recording window. */
    this.samples = [];
    this.lastTrial = null;
  }

  // ── Lifecycle transitions ─────────────────────────────────────────────

  cameraStarted() { this._set(TrialState.CAMERA_READY); }

  cameraStopped() {
    // A trial interrupted by the camera stopping is discarded, not saved:
    // a partial window is not a valid measurement of the scenario.
    this.scenario = null;
    this.samples = [];
    this.recordingStartedAt = null;
    this.recordingEndedAt = null;
    this._set(TrialState.CAMERA_OFF);
  }

  /** Choose (or clear) a scenario. Never starts recording. */
  selectScenario(scenario) {
    if (this.isBusy()) return false;
    this.scenario = scenario;
    this._set(scenario ? TrialState.SCENARIO_SELECTED : TrialState.CAMERA_READY);
    return true;
  }

  /**
   * Begin the countdown. Recording does NOT begin here.
   * @param {number} nowMs
   * @param {Object} ctx {trialId, repetition}
   */
  startTrial(nowMs, ctx = {}) {
    if (!this.scenario) return false;
    if (this.isBusy()) return false;
    this.countdownStartedAt = nowMs;
    this.recordingStartedAt = null;
    this.recordingEndedAt = null;
    this.samples = [];
    this.currentTrialId = ctx.trialId ?? null;
    this.currentRepetition = ctx.repetition ?? null;
    this._set(TrialState.COUNTDOWN);
    return true;
  }

  /** Abort at any point before SAVING. Nothing is persisted. */
  abort(reason = 'aborted by operator') {
    if (this.state === TrialState.CAMERA_OFF) return null;
    const wasRecording = this.state === TrialState.RECORDING;
    this.samples = [];
    this.recordingStartedAt = null;
    this.recordingEndedAt = null;
    this._set(this.scenario ? TrialState.SCENARIO_SELECTED : TrialState.CAMERA_READY);
    return wasRecording ? reason : null;
  }

  /**
   * Advance the clock. The page calls this every animation frame.
   * Handles COUNTDOWN -> RECORDING -> SAVING automatically, so recording
   * length is enforced by the controller rather than by operator reaction time.
   *
   * @param {number} nowMs
   * @returns {{state:string, remainingMs:number, elapsedMs:number, trial:Object|null}}
   */
  tick(nowMs) {
    let completed = null;

    if (this.state === TrialState.COUNTDOWN) {
      const elapsed = nowMs - this.countdownStartedAt;
      if (elapsed >= this.scenario.countdownMs) {
        // GO. This timestamp is the hard lower bound of the trial window.
        this.recordingStartedAt = nowMs;
        this._set(TrialState.RECORDING);
      }
    } else if (this.state === TrialState.RECORDING) {
      const elapsed = nowMs - this.recordingStartedAt;
      if (elapsed >= this.scenario.recordingDurationMs) {
        this.recordingEndedAt = nowMs;
        this._set(TrialState.SAVING);
        completed = this._finalise();
      }
    }

    return {
      state: this.state,
      remainingMs: this.state === TrialState.COUNTDOWN
        ? Math.max(0, this.scenario.countdownMs - (nowMs - this.countdownStartedAt)) : 0,
      elapsedMs: this.state === TrialState.RECORDING
        ? Math.max(0, nowMs - this.recordingStartedAt) : 0,
      trial: completed,
    };
  }

  /**
   * Offer a sample to the current trial.
   *
   * THE RECORDING BOUNDARY. A sample is accepted only when the controller is
   * RECORDING and the timestamp lies within the window. Everything else — idle
   * preview, countdown, saving, post-trial — is rejected and stays ephemeral.
   *
   * @param {Object} sample must carry `timestampMs`
   * @returns {boolean} whether it was recorded
   */
  offerSample(sample) {
    if (this.state !== TrialState.RECORDING) return false;
    if (this.recordingStartedAt === null) return false;
    const t = sample?.timestampMs;
    if (typeof t !== 'number' || !Number.isFinite(t)) return false;
    if (t < this.recordingStartedAt) return false;
    if (this.recordingEndedAt !== null && t > this.recordingEndedAt) return false;

    this.samples.push({
      ...sample,
      trialId: this.currentTrialId,
      scenario: this.scenario?.id ?? null,
      repetition: this.currentRepetition,
      relativeTimeMs: t - this.recordingStartedAt,
    });
    return true;
  }

  /** True while a trial is in progress and cannot be reconfigured. */
  isBusy() {
    return this.state === TrialState.COUNTDOWN
      || this.state === TrialState.RECORDING
      || this.state === TrialState.SAVING;
  }

  isRecording() { return this.state === TrialState.RECORDING; }

  /** Assemble the bounded trial record and return to CAMERA_READY. */
  _finalise() {
    const trial = {
      trialId: this.currentTrialId,
      scenario: this.scenario.id,
      repetition: this.currentRepetition,
      instruction: this.scenario.instruction ?? null,
      expectedSemanticOutcome: this.scenario.expectedSemanticOutcome ?? null,
      countdownStartedAt: this.countdownStartedAt,
      recordingStartedAt: this.recordingStartedAt,
      recordingEndedAt: this.recordingEndedAt,
      recordingDurationMs: this.recordingEndedAt - this.recordingStartedAt,
      sampleCount: this.samples.length,
      samples: this.samples,
      valid: true,
      invalidReason: null,
      notes: '',
    };
    this.lastTrial = trial;
    this._set(TrialState.RECORDED);
    this.onTrialComplete(trial);
    // Immediately return to a resting state: RECORDED is informational, and
    // leaving the machine there would let the next frames look "in a trial".
    this._set(TrialState.SCENARIO_SELECTED);
    return trial;
  }

  _set(next) {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange({ state: next, scenario: this.scenario });
  }
}

export default TrialController;
