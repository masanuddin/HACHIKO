/**
 * HACHIKO — Debug harness controller  (tools/debug)
 * =================================================
 * Camera + render loop + readout wiring for the AI test page.
 *
 * THIS IS NOT PRODUCT UI, and as of v0.2.1 it is not part of the AI core
 * either. It lives outside src/ai and consumes the public API only, exactly
 * as the product app will.
 *
 * It DOES own a webcam — deliberately. This is the standalone tester, so it
 * calls getUserMedia and manages the stream lifecycle. The AI core never does;
 * in the product app, the app owns the camera and feeds frames in.
 */

import {
  HachikoAI, FaceLandmarkerEngine, ObjectDetectorEngine,
  CONFIG, withOverrides, AIState, ScenarioTruth, PresenceStatus,
} from '../../src/ai/index.js';
import { TrialController, TrialState, statusLabel } from '../shared/TrialController.js';
import { DebugSession, toSample } from './DebugSession.js';
import { getScenario } from './scenarios.js';
import { buildZip } from '../shared/zip.js';
import { buildDebugViewModel, Absent } from './debugViewModel.js';

export class DebugHarness {
  /**
   * @param {Object} deps  { FilesetResolver, FaceLandmarker, assetPaths? }
   * @param {Object} els   DOM element map
   */
  constructor(deps, els) {
    this.deps = deps;
    this.els = els;
    this.ai = new HachikoAI(CONFIG);
    this.engine = new FaceLandmarkerEngine(CONFIG, deps);

    // ── FACE AI ONLY (v0.3 interim) ────────────────────────────────────
    // The physical-presence and phone models have NOT been selected — the
    // Bake-off is still running. Executing the old provisional detector here
    // would present unselected, known-weak output as if it were the product's
    // perception layer. So it is not constructed and not run: presence and
    // phone read PENDING BAKE-OFF instead of showing misleading numbers.
    this.objectEngine = null;
    this.perceptionPending = true;
    this._lastObjects = null;
    this._lastObjectInferenceMs = 0;
    this._lastRawDetections = [];

    // ── Experiment recording ───────────────────────────────────────────
    this.session = new DebugSession(CONFIG);
    this.trials = new TrialController({
      requiredRepetitions: this.session.requiredRepetitions,
      onStateChange: (info) => this._onTrialState(info),
      onTrialComplete: (trial) => this._onTrialComplete(trial),
    });
    this.onTrialEvent = () => {};
    /** Page-supplied renderer for panels this class does not own. */
    this.onViewModel = null;
    this.lastTrialRecord = null;
    this.stream = null;
    this.running = false;
    this._rafId = null;
    this._lastMeasurement = null;
    /**
     * Rolling face-inference latency, for p50/p95 in the Runtime tab.
     * Owned here, not in the AI core: percentile reporting is a debug-tool
     * concern and the core stays a per-frame reporter.
     */
    this.latency = [];
    /** Live min/max tracking for the sign-convention gate. */
    this.extremes = null;
    this._resetExtremes();
  }

  _resetExtremes() {
    this.extremes = {
      yawRaw: { min: Infinity, max: -Infinity },
      pitchRaw: { min: Infinity, max: -Infinity },
      rollRaw: { min: Infinity, max: -Infinity },
      earMean: { min: Infinity, max: -Infinity },
      nonFinite: 0, wrapSuspect: 0,
    };
  }

  /**
   * Track observed ranges. This is the machinery for Gate 7: it makes
   * monotonicity and sign direction checkable at a glance, and counts any
   * NaN/Infinity or near-180 wrap artefacts that would indicate the v0.1
   * pitch bug had returned.
   */
  _trackExtremes(m) {
    const upd = (key, v) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        if (v !== null) this.extremes.nonFinite++;
        return;
      }
      const e = this.extremes[key];
      if (v < e.min) e.min = v;
      if (v > e.max) e.max = v;
    };
    upd('yawRaw', m.yawRaw);
    upd('pitchRaw', m.pitchRaw);
    upd('rollRaw', m.rollRaw);
    upd('earMean', m.earMean);
    for (const v of [m.yawRaw, m.pitchRaw, m.rollRaw]) {
      if (typeof v === 'number' && Number.isFinite(v) && Math.abs(Math.abs(v) - 180) < 40) {
        this.extremes.wrapSuspect++;
      }
    }
  }

  /**
   * Toggle raw-observation mode for the object detector.
   *
   * Rebuilds the detector WITHOUT the category allowlist and with a low score
   * floor, so every class is visible for inspection. Only affects diagnostics:
   * PresenceFusion and PhoneEventTracker still consume accepted detections
   * only, and the production config object is never mutated.
   *
   * @returns {boolean} the new state
   */
  toggleDiagnosticMode() {
    this._diagnostic = !this._diagnostic;
    const diagConfig = withOverrides({
      objectDetector: { diagnosticMode: this._diagnostic },
    });
    this.objectEngine = this.deps.ObjectDetector
      ? new ObjectDetectorEngine(diagConfig, this.deps)
      : null;
    this._lastObjects = null;
    this._lastRawDetections = [];
    return this._diagnostic;
  }

  isDiagnosticMode() { return this._diagnostic; }

  /**
   * Set the manual ground-truth scenario label.
   * Annotation only — it cannot influence the prediction.
   */
  setScenarioTruth(scenario) {
    this.ai.setScenarioTruth(scenario ?? ScenarioTruth.NONE);
  }

  async start() {
    if (this.running) return;
    this._setStatus('requesting camera…');

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: CONFIG.camera.width },
        height: { ideal: CONFIG.camera.height },
        facingMode: CONFIG.camera.facingMode,
        frameRate: { ideal: CONFIG.camera.targetFps },
      },
      audio: false,
    });

    const video = this.els.video;
    video.srcObject = this.stream;
    await video.play();

    this._setStatus('loading face model…');
    await this.engine.initialize();
    // Presence/phone perception is PENDING BAKE-OFF, so no second model loads.
    this._setStatus(`camera on — NOT RECORDING (face: ${this.engine.activeDelegate})`);

    this.running = true;
    this.trials.cameraStarted();
    this._loop();
  }

  stop() {
    this.running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.engine.close();
    this.trials.cameraStopped();
    this._setStatus('stopped');
  }

  calibrate() {
    this.ai.startCalibration(performance.now());
    // Record the baseline alongside the trials it will be used to interpret.
    setTimeout(() => {
      this.session.calibrationSnapshot = this.ai.getCalibrationSnapshot();
    }, CONFIG.calibration.CALIBRATION_DURATION_MS + 250);
    this._setStatus('calibrating — look at the screen normally');
  }

  reset() {
    this.ai.reset();
    this.trials.abort('reset');
    this._resetExtremes();
    this._setStatus('reset — calibration and AI state cleared');
  }

  // ── Trial control ────────────────────────────────────────────────────

  /** Select (or clear) the scenario. Never begins recording. */
  selectScenario(scenarioId) {
    const scenario = scenarioId ? getScenario(scenarioId) : null;
    if (scenario?.pending) return { ok: false, reason: scenario.pendingReason };
    const ok = this.trials.selectScenario(scenario);
    if (ok) {
      // The ground-truth label is attached for telemetry provenance only; the
      // engine cannot read it.
      this.setScenarioTruth(scenarioId ?? ScenarioTruth.NONE);
      this._setStatus(scenario
        ? `ready — ${scenario.id} (press START TRIAL)` : 'camera on — NOT RECORDING');
    }
    return { ok, scenario };
  }

  /** Begin countdown -> recording -> auto-stop for the selected scenario. */
  startTrial() {
    const scenario = this.trials.scenario;
    if (!scenario) return { ok: false, reason: 'no scenario selected' };
    const ref = this.session.nextTrialRef(scenario.id);
    const ok = this.trials.startTrial(performance.now(), ref);
    return { ok, ...ref };
  }

  abortTrial(reason = 'aborted by operator') {
    const wasRecording = this.trials.abort(reason);
    if (wasRecording) this.session.abortedCount += 1;
    return wasRecording;
  }

  /** Mark the most recent (or a named) trial invalid. Evidence is retained. */
  /**
   * Delete the most recent saved trial, literally. It leaves no row in any
   * export, no telemetry, and no tombstone — as though it never happened.
   */
  deleteLastTrial() {
    const removed = this.session.deleteLastTrial();
    if (removed) this.lastTrialRecord = null;
    return removed;
  }

  /** The trial Delete Last Trial would remove, for the confirm dialog. */
  lastTrial() { return this.session.lastTrial(); }

  getProgress(scenarios) { return this.session.progress(scenarios); }

  _onTrialState(info) {
    this.onTrialEvent({ type: 'state', ...info });
  }

  _onTrialComplete(trial) {
    const scenario = getScenario(trial.scenario);
    const record = this.session.addTrial(trial, scenario);
    this.lastTrialRecord = record;
    this.onTrialEvent({ type: 'complete', trial: record });
  }

  _renderTrialStatus(tick, nowMs) {
    const e = this.els;
    if (!e.recState) return;
    const ctx = {
      scenarioId: this.trials.scenario?.id,
      remainingMs: tick.remainingMs,
      elapsedMs: tick.elapsedMs,
      durationMs: this.trials.scenario?.recordingDurationMs ?? 0,
      repetition: this.trials.currentRepetition,
    };
    e.recState.textContent = statusLabel(tick.state, ctx);
    e.recState.className = 'val ' + (
      tick.state === TrialState.RECORDING ? 'bad'
        : tick.state === TrialState.COUNTDOWN ? 'warn'
          : tick.state === TrialState.CAMERA_OFF ? 'dimval' : 'ok');
  }

  _loop = () => {
    if (!this.running) return;
    const now = performance.now();

    try {
      // FACE AI ONLY while the perception Bake-off is unresolved. No object
      // detector is constructed or executed here, so nothing provisional can
      // be mistaken for the final presence/phone layer.
      const { measurement, inferenceMs, skipped } = this.engine.detect(this.els.video, now);
      if (!skipped && measurement) {
        this._lastMeasurement = measurement;
        this._trackExtremes(measurement);
        const frame = this.ai.processFrame(measurement, now, {
          faceInferenceMs: inferenceMs,
          objectInferenceMs: 0,
          objectDetections: null,
        });

        // Advance the trial clock, then offer the frame. `offerSample` is the
        // single gate: it accepts ONLY inside the recording window, so preview,
        // countdown and post-trial frames can never enter the experiment.
        const tick = this.trials.tick(now);
        this.trials.offerSample({ ...toSample(frame), timestampMs: now });

        this._render(frame);
        this._renderTrialStatus(tick, now);
      }
    } catch (err) {
      console.error('[HACHIKO] frame error:', err);
      this._setStatus(`error: ${err.message}`);
    }

    this._rafId = requestAnimationFrame(this._loop);
  };

  /**
   * Rolling inference-latency stats for the Runtime tab.
   * Owned here rather than in the AI core: percentile reporting is a debug-tool
   * concern and the core stays a per-frame reporter.
   */
  _latencyStats() {
    if (!this.latency.length) return { p50: null, p95: null, count: 0 };
    const sorted = this.latency.slice().sort((a, b) => a - b);
    const at = (f) => sorted[Math.min(sorted.length - 1, Math.floor(f * (sorted.length - 1)))];
    return { p50: at(0.5), p95: at(0.95), count: sorted.length };
  }

  /**
   * The canonical per-frame view model.
   *
   * Every panel reads THIS. The centre and the Signal Inspector cannot
   * disagree, because there is only one derivation and only one subscriber.
   */
  buildViewModel(frame) {
    const v = this.els.video;
    return buildDebugViewModel(frame, {
      cameraOn: this.running,
      calibration: this.ai.getCalibrationSnapshot(),
      config: CONFIG,
      extremes: this.extremes,
      latency: this._latencyStats(),
      delegate: this.engine.activeDelegate,
      video: v?.videoWidth ? { width: v.videoWidth, height: v.videoHeight } : null,
    });
  }

  _render(frame) {
    const e = this.els;
    const perf = frame.performance ?? {};
    if (typeof perf.inferenceMs === 'number' && Number.isFinite(perf.inferenceMs)) {
      this.latency.push(perf.inferenceMs);
      if (this.latency.length > 240) this.latency.shift();
    }
    const m = frame.measurement, c = frame.calibrated;
    const t = frame.temporal, d = frame.classification, p = frame.performance;

    const fmt = (v, dp = 1) =>
      typeof v === 'number' && Number.isFinite(v) ? v.toFixed(dp) : '—';

    e.face.textContent = m.facePresent ? 'YES' : 'NO';
    e.face.className = `val ${m.facePresent ? 'ok' : 'bad'}`;
    if (e.face2) {
      e.face2.textContent = e.face.textContent;
      e.face2.className = e.face.className;
    }

    e.poseValid.textContent = m.poseValid ? 'VALID' : `INVALID (${m.poseInvalidReason})`;
    e.poseValid.className = `val ${m.poseValid ? 'ok' : 'bad'}`;

    // Head pose, one authoritative write per cell.
    //   raw      -> HeadPoseExtractor, valid only when poseValid
    //   delta    -> raw minus calibration baseline, needs a valid baseline
    //   smoothed -> FeatureSmoother output
    // Each is state-aware: a missing value says WHY rather than showing a dash.
    const calValid = this.ai.getCalibrationSnapshot().status === 'VALID';
    const poseCell = (el, v, needsBaseline = false) => {
      if (!el) return;
      if (!m.facePresent) { el.textContent = 'No face'; el.className = 'dimval'; return; }
      if (!m.poseValid) { el.textContent = 'Signal invalid'; el.className = 'warn'; return; }
      if (needsBaseline && !calValid) {
        el.textContent = 'Requires calibration'; el.className = 'warn'; return;
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        el.textContent = 'Unavailable'; el.className = 'bad'; return;
      }
      el.textContent = `${v.toFixed(1)}°`;
      el.className = '';
    };
    poseCell(e.yawRaw, m.yawRaw);
    poseCell(e.yawDelta, c.yawDelta, true);
    poseCell(e.yawSm, t.yawSmoothed);
    poseCell(e.pitchRaw, m.pitchRaw);
    poseCell(e.pitchDelta, c.pitchDelta, true);
    poseCell(e.pitchSm, t.pitchSmoothed);
    // "Head Tilt" in the UI; roll stays the internal/export name.
    poseCell(e.rollRaw, m.rollRaw);
    poseCell(e.rollDelta, c.rollDelta, true);
    poseCell(e.rollSm, t.rollSmoothed);

    const earCell = (el, v, needsBaseline = false) => {
      if (!el) return;
      if (!m.facePresent) { el.textContent = 'No face'; el.className = 'dimval'; return; }
      if (needsBaseline && !calValid) {
        el.textContent = 'Requires calibration'; el.className = 'warn'; return;
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        el.textContent = 'Unavailable'; el.className = 'bad'; return;
      }
      el.textContent = v.toFixed(3);
      el.className = '';
    };
    earCell(e.earL, m.earLeft);
    earCell(e.earR, m.earRight);
    earCell(e.earMean, m.earMean);
    earCell(e.earRel, c.earRelative, true);
    earCell(e.earSm, t.earSmoothed);
    // Face-missing is only meaningful while the face is actually missing.
    const missingMs = Math.round(t.faceMissingMs ?? 0);
    if (e.missing) e.missing.textContent = `${missingMs} ms`;
    if (e.faceMissingRow) {
      e.faceMissingRow.style.display = missingMs > 0 ? '' : 'none';
    }

    e.state.textContent = d.state;
    e.state.className = `state ${d.state}`;
    e.reason.textContent = d.primaryReason ?? d.reason;
    e.stateDur.textContent = `${(d.stateDurationMs / 1000).toFixed(1)} s`;

    // Evidence flags, tier-labelled. Support flags render in a muted style so
    // it stays visually obvious they cannot trigger TERALIH.
    const ev = frame.evidence?.active ?? {};
    const flag = (el, on, tier) => {
      if (!el) return;
      el.textContent = on ? 'YES' : 'no';
      el.className = `val ${on ? (tier === 'STRONG' ? 'bad' : 'warn') : 'dimval'}`;
    };
    flag(e.evYaw, ev.yawStrong, 'STRONG');
    flag(e.evPitchUp, ev.pitchUpStrong, 'STRONG');
    flag(e.evEye, ev.eyeClosureStrong, 'STRONG');
    flag(e.evPitchDown, ev.pitchDownSupport, 'SUPPORT');
    flag(e.evRoll, ev.rollSupport, 'SUPPORT');

    // Accumulation bars make persistence visible during manual testing.
    //
    // The support timers already run in TemporalTracker and their accumulated
    // values are already emitted in telemetry — these bars only render what
    // was previously computed and discarded by the UI. Support bars are marked
    // so they stay visually muted even at 100%: a full support bar is expected
    // during reading or head-tilt and must never look like a pending state
    // change.
    const acc = frame.evidence?.accumulated ?? {};
    const s = CONFIG.state;
    this._bar(e.yawBar, acc.yawStrong, s.YAW_PERSIST_MS);
    this._bar(e.pitchUpBar, acc.pitchUpStrong, s.PITCH_UP_PERSIST_MS);
    this._bar(e.eyeBar, acc.eyeClosureStrong, s.EYE_CLOSED_PERSIST_MS);
    this._bar(e.pitchDownBar, acc.pitchDownSupport, s.DOWN_PITCH_SUPPORT_PERSIST_MS, 'support');
    this._bar(e.rollBar, acc.rollSupport, s.ROLL_SUPPORT_PERSIST_MS, 'support');

    // Eye-evidence geometry gate. EAR is always measured and logged; this
    // only reports whether it was trustworthy enough to count as evidence.
    if (e.eyeElig) {
      const ok = frame.evidence?.eyeEligible;
      e.eyeElig.textContent = ok
        ? 'eligible'
        : `ineligible (${frame.evidence?.eyeIneligibleReason ?? '?'})`;
      e.eyeElig.className = `val ${ok ? 'ok' : 'warn'}`;
    }

    // ── PRESENCE / PHONE: PENDING BAKE-OFF ─────────────────────────────
    // The physical-presence and phone models are not selected yet, so no
    // provisional detector runs. These readouts say so plainly rather than
    // showing zeros or stale values that could read as real measurements.
    const PENDING = 'PENDING BAKE-OFF';
    if (e.presenceModel) e.presenceModel.textContent = PENDING;
    if (e.phoneModel) e.phoneModel.textContent = PENDING;
    // §14: no per-field N/A rows. Until a model is selected there is nothing
    // to report, and a column of "N/A" reads as measurement rather than
    // absence. These nodes are proxies now; the cards say PENDING BAKE-OFF.
    if (e.stateValid) {
      const ok = frame.validity?.stateSignalValid;
      e.stateValid.textContent = ok ? 'VALID' : 'NOT OBSERVABLE';
      e.stateValid.className = `val ${ok ? 'ok' : 'warn'}`;
    }

    // ── PERCEPTION RAW: PENDING BAKE-OFF ───────────────────────────────
    // Nothing to show: no perception model is running. Once the Bake-off picks
    // a winner this becomes its raw detections, scores and rejections.
    if (e.rawCount) {
      for (const key of ['rawCount', 'acceptedCount', 'inferCount',
                         'nameAvail', 'rejects', 'rawTop']) {
        if (e[key]) { e[key].textContent = 'PENDING BAKE-OFF'; e[key].className = 'val dimval'; }
      }
      if (e.videoDims) {
        const v = this.els.video;
        e.videoDims.textContent = v?.videoWidth ? `${v.videoWidth}x${v.videoHeight}` : '—';
        e.videoDims.className = 'val';
      }
    }

    // Presence/absence is its own concern, not an evidence tier: it decides
    // whether the user is observable at all, before any head-pose rule applies.
    this._bar(e.faceBar, t.faceMissingMs, s.FACE_MISSING_ENTER_MS);
    if (e.evAbsence) {
      const absent = d.state === AIState.TIDAK_HADIR;
      const missing = (t.faceMissingMs ?? 0) > 0;
      e.evAbsence.textContent = absent ? 'ABSENT' : missing ? 'missing' : 'present';
      e.evAbsence.className = `val ${absent ? 'bad' : missing ? 'warn' : 'ok'}`;
    }
    if (e.presentMs) {
      e.presentMs.textContent = `${Math.round(t.facePresentMs ?? 0)} ms`;
    }

    // Gate-7 observed ranges.
    if (e.rangeYaw) {
      const r = (k, dp = 1) => {
        const x = this.extremes[k];
        return Number.isFinite(x.min)
          ? `${x.min.toFixed(dp)} … ${x.max.toFixed(dp)}` : '—';
      };
      e.rangeYaw.textContent = r('yawRaw');
      e.rangePitch.textContent = r('pitchRaw');
      e.rangeRoll.textContent = r('rollRaw');
      e.rangeEar.textContent = r('earMean', 3);
      e.anomalies.textContent =
        `nonFinite ${this.extremes.nonFinite} · wrapSuspect ${this.extremes.wrapSuspect}`;
      e.anomalies.className = `val ${
        this.extremes.nonFinite || this.extremes.wrapSuspect ? 'bad' : 'ok'}`;
    }

    e.fps.textContent = fmt(p.fps, 1);
    e.inference.textContent = `${fmt(p.inferenceMs, 2)} ms`;

    // Percentiles and the rest of the Runtime tab are rendered from the view
    // model below, so every panel agrees by construction.

    const cal = this.ai.getCalibrationSnapshot();

    // ── HEADER ────────────────────────────────────────────────────────
    // The header previously had no writer at all, so it showed a permanent
    // dash while the body showed live values. It now reads the SAME frame and
    // the SAME calibration snapshot the body does, so the two cannot diverge.
    if (e.hState) {
      e.hState.textContent = d.state;
      e.hState.className = 'val ' + (d.state === AIState.FOKUS ? 'ok'
        : d.state === AIState.TIDAK_HADIR ? 'bad' : 'warn');
    }
    if (e.hCal) {
      e.hCal.textContent = cal.status;
      e.hCal.className = 'val ' + (cal.status === 'VALID' ? 'ok'
        : cal.status === 'FAILED' ? 'bad' : 'warn');
    }
    if (e.hPerf) {
      e.hPerf.textContent = `${fmt(p.fps, 0)} fps · ${fmt(p.inferenceMs, 1)} ms`;
    }
    if (e.calSamples) {
      e.calSamples.textContent = cal.baseline
        ? String(cal.baseline.sampleCount)
        : (cal.status === 'NONE' ? 'Not started'
           : `${cal.validSamples} valid / ${cal.totalFrames} frames`);
    }
    e.calStatus.textContent = cal.status;
    e.calStatus.className = `val ${cal.status === 'VALID' ? 'ok' : cal.status === 'FAILED' ? 'bad' : 'warn'}`;
    e.calDetail.textContent = cal.baseline
      ? `yaw ${cal.baseline.yaw.toFixed(1)}° · pitch ${cal.baseline.pitch.toFixed(1)}° · EAR ${cal.baseline.ear.toFixed(3)} (n=${cal.baseline.sampleCount})`
      : (cal.failureReason ?? `${cal.validSamples} valid / ${cal.totalFrames} frames`);

    if (e.frames) e.frames.textContent = String(this.session.trials.length);

    // ── ONE SUBSCRIBER ────────────────────────────────────────────────
    // The page used to attach its OWN ai.onFrame listener for the Signal
    // Inspector. HachikoAI isolates a throwing listener, so a single error in
    // that handler silently blanked the whole right panel while this one kept
    // working. Now the page registers a renderer here and receives the same
    // view model this method used, so the two cannot diverge — and if the page
    // renderer throws, it throws where we can see it.
    if (this.onViewModel) {
      this.onViewModel(this.buildViewModel(frame));
    }

    if (d.calibrating) {
      const prog = Math.round(this.ai.calibration.progress(frame.timestampMs) * 100);
      this._setStatus(`calibrating… ${prog}%`);
    }
  }

  /**
   * @param {HTMLElement} el
   * @param {number} valueMs   accumulated persistence
   * @param {number} requiredMs persistence window for this signal
   * @param {string} [variant] 'support' keeps the fill muted even at 100%
   */
  _bar(el, valueMs, requiredMs, variant = '') {
    if (!el) return;
    const pct = requiredMs > 0
      ? Math.min(100, ((valueMs ?? 0) / requiredMs) * 100)
      : 0;
    el.style.width = `${pct}%`;
    el.className = `bar-fill ${variant} ${pct >= 100 ? 'full' : ''}`.replace(/\s+/g, ' ').trim();
  }

  _setStatus(text) {
    if (this.els.status) this.els.status.textContent = text;
  }

  /**
   * Export the bounded experiment as ONE archive containing
   * debug_results.json + debug_trials.csv + debug_telemetry.csv.
   *
   * Derived numbers only — never imagery. Only trial-window telemetry is
   * included; live preview frames never reach this path.
   *
   * A single ZIP rather than three downloads: browsers block consecutive
   * downloads as "multiple downloads" after the first, and the tester should
   * not have to work out which files belong to the same session.
   */
  exportSession() {
    const bundle = this.session.buildExportBundle({
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      viewport: typeof window !== 'undefined'
        ? `${window.innerWidth}x${window.innerHeight}` : null,
      videoWidth: this.els.video?.videoWidth ?? null,
      videoHeight: this.els.video?.videoHeight ?? null,
      hardwareConcurrency: typeof navigator !== 'undefined'
        ? navigator.hardwareConcurrency ?? null : null,
    });
    this._downloadZip(bundle);
    return bundle;
  }

  _downloadZip(bundle) {
    const blob = new Blob([buildZip(bundle.files)], { type: 'application/zip' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = bundle.archiveName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

}

export { AIState };
export default DebugHarness;
