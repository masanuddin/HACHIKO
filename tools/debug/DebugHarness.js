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
  HachikoAI, FaceLandmarkerEngine, CONFIG, AIState, ScenarioTruth,
} from '../../src/ai/index.js';
import { TelemetryLogger } from '../telemetry/TelemetryLogger.js';

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
    // The harness owns its logger and attaches it to the AI's frame stream.
    // The AI itself knows nothing about it.
    this.logger = new TelemetryLogger(CONFIG);
    this.logger.attach(this.ai, { harness: 'tools/debug' });
    this.stream = null;
    this.running = false;
    this._rafId = null;
    this._lastMeasurement = null;
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

    this._setStatus('loading model…');
    await this.engine.initialize();
    this._setStatus(`ready (delegate: ${this.engine.activeDelegate})`);

    this.running = true;
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
    this._setStatus('stopped');
  }

  calibrate() {
    this.ai.startCalibration(performance.now());
    this._setStatus('calibrating — look at the screen normally');
  }

  reset() {
    this.ai.reset();
    // Re-attach so the logger starts a fresh session with current provenance.
    this.logger.attach(this.ai, { harness: 'tools/debug' });
    this._resetExtremes();
    this._setStatus('reset');
  }

  _loop = () => {
    if (!this.running) return;
    const now = performance.now();

    try {
      const { measurement, inferenceMs, skipped } = this.engine.detect(this.els.video, now);
      if (!skipped && measurement) {
        this._lastMeasurement = measurement;
        this._trackExtremes(measurement);
        const frame = this.ai.processFrame(measurement, now, inferenceMs);
        this._render(frame);
      }
    } catch (err) {
      console.error('[HACHIKO] frame error:', err);
      this._setStatus(`error: ${err.message}`);
    }

    this._rafId = requestAnimationFrame(this._loop);
  };

  _render(frame) {
    const e = this.els;
    const m = frame.measurement, c = frame.calibrated;
    const t = frame.temporal, d = frame.classification, p = frame.performance;

    const fmt = (v, dp = 1) =>
      typeof v === 'number' && Number.isFinite(v) ? v.toFixed(dp) : '—';

    e.face.textContent = m.facePresent ? 'YES' : 'NO';
    e.face.className = `val ${m.facePresent ? 'ok' : 'bad'}`;

    e.poseValid.textContent = m.poseValid ? 'VALID' : `INVALID (${m.poseInvalidReason})`;
    e.poseValid.className = `val ${m.poseValid ? 'ok' : 'bad'}`;

    e.yaw.textContent = `${fmt(m.yawRaw)}° / ${fmt(c.yawDelta)}° / ${fmt(t.yawSmoothed)}°`;
    e.pitch.textContent = `${fmt(m.pitchRaw)}° / ${fmt(c.pitchDelta)}° / ${fmt(t.pitchSmoothed)}°`;
    e.roll.textContent = `${fmt(m.rollRaw)}° / ${fmt(c.rollDelta)}° / ${fmt(t.rollSmoothed)}°`;

    e.earL.textContent = fmt(m.earLeft, 3);
    e.earR.textContent = fmt(m.earRight, 3);
    e.earMean.textContent = fmt(m.earMean, 3);
    e.earRel.textContent = fmt(c.earRelative, 3);
    e.earSm.textContent = fmt(t.earSmoothed, 3);
    e.missing.textContent = `${Math.round(t.faceMissingMs)} ms`;

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

    const cal = this.ai.getCalibrationSnapshot();
    e.calStatus.textContent = cal.status;
    e.calStatus.className = `val ${cal.status === 'VALID' ? 'ok' : cal.status === 'FAILED' ? 'bad' : 'warn'}`;
    e.calDetail.textContent = cal.baseline
      ? `yaw ${cal.baseline.yaw.toFixed(1)}° · pitch ${cal.baseline.pitch.toFixed(1)}° · EAR ${cal.baseline.ear.toFixed(3)} (n=${cal.baseline.sampleCount})`
      : (cal.failureReason ?? `${cal.validSamples} valid / ${cal.totalFrames} frames`);

    e.frames.textContent = String(this.logger.length);
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

  /** Download telemetry. Derived numbers only — never imagery. */
  downloadCSV() {
    this._download(this.logger.toCSV(), 'text/csv', 'csv');
  }
  downloadJSON() {
    this._download(this.logger.toJSON(), 'application/json', 'json');
  }
  /**
   * Offline analysis pack: distributions, transitions, detection delays, and
   * ground-truth-vs-prediction agreement. Fills report sections I-K.
   */
  downloadAnalysis() {
    const report = {
      generatedAt: new Date().toISOString(),
      note: 'PROVISIONAL thresholds. d_/g_ separation: prediction is never ground truth.',
      delegate: this.engine.activeDelegate,
      observedRanges: this.extremes,
      calibration: this.ai.getCalibrationSnapshot(),
      analysis: this.logger.analyze(),
    };
    this._download(JSON.stringify(report, null, 2), 'application/json', 'analysis.json');
  }
  /** Console helper for live manual testing. */
  printAnalysis() {
    const a = this.logger.analyze();
    console.table(a.distributions);
    console.log('transitions:', a.transitionCount, a.transitions);
    console.log('groundTruth vs prediction:', a.groundTruth);
    console.log('detectionDelays:', a.detectionDelays);
    return a;
  }
  _download(content, mime, ext) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hachiko_ai_v0.1_${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

export { AIState };
export default DebugHarness;
