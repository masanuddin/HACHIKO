/**
 * HACHIKO AI v0.2.1 — Orchestrator
 * ================================
 * Wires the pipeline together and exposes the public AI surface.
 *
 *   Measurement -> Calibration -> Smoothing -> Temporal -> Evidence -> State
 *
 * `processFrame` is the pure heart of the system: it takes a raw measurement
 * plus a timestamp and returns a structured telemetry frame. It never touches
 * the camera or the DOM, so the entire pipeline below MediaPipe is testable in
 * Node by feeding synthetic measurements — which is exactly what tests/ does.
 *
 * ── v0.2.1 BOUNDARY ───────────────────────────────────────────────────────
 * This class EMITS structured telemetry; it does not STORE it. Ring buffers,
 * CSV/JSON serialisation, and offline analysis moved to tools/telemetry, which
 * is a consumer of `onFrame()` like any other. The AI core therefore has no
 * opinion about persistence, file formats, or the DOM, and the product app can
 * route frames wherever it wants without dragging a logger along.
 *
 * The core also does NOT own the camera: it never calls getUserMedia and never
 * starts or stops a stream. Callers supply a measurement per frame. The debug
 * harness (tools/debug) owns a webcam only because it is a standalone tester.
 */

import { CONFIG } from './config.js';
import { AIState, StateReason, CalibrationStatus, ScenarioTruth } from './types.js';
import { CalibrationEngine } from './pipeline/CalibrationEngine.js';
import { FeatureSmoother } from './pipeline/FeatureSmoother.js';
import { TemporalTracker } from './pipeline/TemporalTracker.js';
import { EvidenceEngine } from './pipeline/EvidenceEngine.js';
import { StateEngine } from './pipeline/StateEngine.js';
import { isFiniteNumber } from './core/math.js';

/** Rolling mean of the last N frame intervals, for effective FPS. */
class FpsMeter {
  constructor(window = 30) {
    this.window = window;
    this.samples = [];
    this._lastMs = null;
  }
  reset() { this.samples = []; this._lastMs = null; }
  update(nowMs) {
    if (isFiniteNumber(this._lastMs)) {
      const dt = nowMs - this._lastMs;
      // Measures the FULL cycle (inference + render + logging), unlike the
      // Python harness which timed only detect_for_video and so overstated
      // throughput.
      if (dt > 0 && dt < 2000) {
        this.samples.push(dt);
        if (this.samples.length > this.window) this.samples.shift();
      }
    }
    this._lastMs = nowMs;
  }
  get fps() {
    if (this.samples.length === 0) return 0;
    const mean = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    return mean > 0 ? 1000 / mean : 0;
  }
}

export class HachikoAI {
  /**
   * @param {Object} [config=CONFIG]
   */
  constructor(config = CONFIG) {
    this.config = config;
    this.calibration = new CalibrationEngine(config);
    this.smoother = new FeatureSmoother(config);
    // One EvidenceEngine shared by the tracker (instantaneous thresholds) and
    // the state engine (fusion), so the tier rules exist in exactly one place.
    this.evidenceEngine = new EvidenceEngine(config);
    this.temporal = new TemporalTracker(config, this.evidenceEngine);
    this.stateEngine = new StateEngine(config, this.evidenceEngine);
    this.fpsMeter = new FpsMeter();
    this._listeners = new Set();
    this._lastState = null;
    /**
     * Manual scenario annotation for acceptance testing. GROUND TRUTH ONLY.
     * Held here purely so the logger can copy it into telemetry; it is never
     * passed to calibration, smoothing, evidence, or the state engine, so it
     * cannot influence a prediction. Enforced by test.
     */
    this._scenarioTruth = ScenarioTruth.NONE;
    /** Incremented on reset() so consumers can detect a session boundary. */
    this.sessionId = 1;
  }

  /**
   * Provenance for a telemetry consumer's session header. The core exposes the
   * config it is actually running with; it does not write files itself.
   */
  getSessionInfo() {
    return {
      sessionId: this.sessionId,
      schemaVersion: 'hachiko-ai-v0.2',
      config: {
        state: { ...this.config.state },
        temporal: { ...this.config.temporal },
        calibration: { ...this.config.calibration },
        validity: { ...this.config.validity },
      },
    };
  }

  /**
   * Set the manual ground-truth label recorded alongside predictions.
   * Does NOT affect classification in any way.
   * @param {string} scenario one of ScenarioTruth
   */
  setScenarioTruth(scenario) {
    this._scenarioTruth = scenario ?? ScenarioTruth.NONE;
  }

  getScenarioTruth() {
    return this._scenarioTruth;
  }

  /**
   * Subscribe to per-frame telemetry. Returns an unsubscribe function.
   *
   * This is the ONLY output channel of the AI core. Loggers, the debug harness,
   * and (later) the product app all attach here; none of them are known to this
   * class. A throwing listener is isolated so one bad consumer cannot break
   * inference.
   *
   * @param {(frame: import('./types.js').TelemetryFrame) => void} fn
   * @returns {() => boolean} unsubscribe
   */
  onFrame(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Begin baseline collection. */
  startCalibration(nowMs) {
    this.calibration.start(nowMs);
    this.smoother.reset();
    this.temporal.reset();
  }

  /**
   * Full reset of AI state: baseline, filters, timers, classification.
   * Does not clear any consumer's stored telemetry — that is the consumer's
   * business. `sessionId` increments so consumers can start a new session.
   */
  reset() {
    this.calibration.reset();
    this.smoother.reset();
    this.temporal.reset();
    this.stateEngine.reset();
    this.fpsMeter.reset();
    this._lastState = null;
    this.sessionId += 1;
  }

  /**
   * Process one raw measurement into a full telemetry frame.
   *
   * PURE with respect to I/O: no camera, no DOM. Deterministic given the same
   * sequence of (measurement, nowMs).
   *
   * @param {Object} measurement from FaceLandmarkerEngine
   * @param {number} nowMs monotonic
   * @param {number} [inferenceMs=0]
   * @returns {import('./types.js').TelemetryFrame}
   */
  processFrame(measurement, nowMs, inferenceMs = 0) {
    this.fpsMeter.update(nowMs);

    // 1. Calibration ------------------------------------------------------
    if (this.calibration.isCollecting()) {
      this.calibration.update(measurement, nowMs);
    }
    const calibrationValid = this.calibration.isValid();

    // 2. Calibrated features ---------------------------------------------
    const calibrated = this.calibration.applyTo(measurement);

    // 3. Smoothing --------------------------------------------------------
    const smoothed = this.smoother.update(calibrated, nowMs);

    // 4. Validity ---------------------------------------------------------
    // signalValid gates EVIDENCE, not presence. Without calibration we can
    // still see the face (so TIDAK_HADIR works), but we refuse to judge
    // distraction against thresholds that were never personalised.
    const signalValid =
      measurement.facePresent &&
      measurement.poseValid &&
      (!this.config.validity.requireCalibrationForEvidence || calibrationValid);

    // 5. Temporal ---------------------------------------------------------
    const temporal = this.temporal.update(
      {
        facePresent: measurement.facePresent,
        signalValid,
        // Smoothed signals drive threshold crossings.
        yawSmoothed: smoothed.yawSmoothed,
        pitchSmoothed: smoothed.pitchSmoothed,
        rollSmoothed: smoothed.rollSmoothed,
        earSmoothed: smoothed.earSmoothed,
        // Unsmoothed values drive the eye-evidence geometry gate, so
        // eligibility follows the head immediately instead of lagging behind
        // the filter. All canonical (see config.headPose).
        poseValid: measurement.poseValid,
        yawDelta: calibrated.yawDelta,
        pitchDelta: calibrated.pitchDelta,
        earLeft: measurement.earLeft,
        earRight: measurement.earRight,
        earMean: measurement.earMean,
      },
      nowMs
    );

    // 6. State ------------------------------------------------------------
    // While still collecting the baseline we deliberately do not classify:
    // reporting TERALIH during calibration would be judging a student against
    // a baseline that does not exist yet.
    let classification;
    if (this.calibration.isCollecting()) {
      classification = {
        state: AIState.FOKUS,
        primaryReason: StateReason.NONE,
        reason: StateReason.NONE,
        activeEvidence: EvidenceEngine.emptyEvidence(),
        stateDurationMs: 0,
        holding: true,
        calibrating: true,
      };
    } else {
      classification = this.stateEngine.update(
        temporal, { signalValid, poseValid: measurement.poseValid, calibrationValid },
        nowMs
      );
      classification.calibrating = false;
    }

    // 7. Telemetry frame --------------------------------------------------
    const frame = {
      timestampMs: nowMs,
      measurement: {
        facePresent: measurement.facePresent,
        poseValid: measurement.poseValid,
        poseInvalidReason: measurement.poseInvalidReason,
        yawRaw: measurement.yawRaw,
        pitchRaw: measurement.pitchRaw,
        rollRaw: measurement.rollRaw,
        earLeft: measurement.earLeft,
        earRight: measurement.earRight,
        earMean: measurement.earMean,
      },
      calibrated: {
        yawDelta: calibrated.yawDelta,
        pitchDelta: calibrated.pitchDelta,
        rollDelta: calibrated.rollDelta,
        earRelative: calibrated.earRelative,
      },
      temporal: {
        yawSmoothed: smoothed.yawSmoothed,
        pitchSmoothed: smoothed.pitchSmoothed,
        rollSmoothed: smoothed.rollSmoothed,
        earSmoothed: smoothed.earSmoothed,
        faceMissingMs: temporal.faceMissingMs,
        facePresentMs: temporal.facePresentMs,
      },
      /**
       * v0.2: evidence is its own telemetry section, between temporal and
       * classification — the layer where "signal crossed a threshold and held"
       * becomes "this counts as evidence of type X".
       */
      evidence: {
        active: classification.activeEvidence,
        instantaneous: temporal.instantaneous,
        accumulated: temporal.accumulated,
        /**
         * Whether EAR was trustworthy enough this frame to contribute
         * EYE_CLOSURE evidence. Raw EAR is ALWAYS present in `measurement`
         * and `calibrated` regardless — this flag gates evidence, not
         * measurement, so the pilot can still analyse EAR at every head angle.
         */
        eyeEligible: temporal.eyeEligible,
        eyeIneligibleReason: temporal.eyeIneligibleReason,
      },
      classification,
      performance: {
        inferenceMs,
        fps: this.fpsMeter.fps,
      },
      validity: {
        signalValid,
        poseValid: measurement.poseValid,
        calibrationValid,
        calibrationStatus: this.calibration.status,
      },
      /**
       * GROUND TRUTH, kept strictly outside `classification`. Never read by any
       * part of the engine. Present so offline analysis can compare prediction
       * against truth without either contaminating the other.
       */
      manualScenarioTruth: this._scenarioTruth,
    };

    // Emit only. Storage, serialisation and analysis belong to consumers
    // (tools/telemetry), not to the AI core.
    for (const fn of this._listeners) {
      try { fn(frame); } catch (err) { console.warn('[HACHIKO] listener error:', err); }
    }
    this._lastState = classification.state;
    return frame;
  }

  getCalibrationSnapshot() { return this.calibration.snapshot(); }
}

export { AIState, StateReason, CalibrationStatus, ScenarioTruth };
export default HachikoAI;
