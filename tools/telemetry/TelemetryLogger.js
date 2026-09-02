/**
 * HACHIKO — TelemetryLogger  (tools/telemetry)
 * ============================================
 * Ring buffer of structured frames, with RAW MEASUREMENT kept strictly separate
 * from DERIVED STATE.
 *
 * ── v0.2.1: THIS IS A TOOL, NOT PART OF THE AI CORE ──────────────────────
 * It lives outside src/ai and is a pure CONSUMER of HachikoAI's `onFrame()`
 * stream. The AI core has no reference to it and no opinion about storage,
 * CSV, or file formats. Attach it with:
 *
 *     const logger = new TelemetryLogger(CONFIG);
 *     logger.attach(ai);            // subscribes; returns a detach function
 *
 * Nothing here can influence inference — it only reads emitted frames.
 *
 * WHY THE SEPARATION IS STRUCTURAL, NOT COSMETIC.
 * The Python harness wrote a flat CSV whose `status` column sat beside yaw/
 * pitch/EAR as if it were a label. Analysis of log_20260820_112600.csv found
 * 536 rows with |yaw| > 30 marked "Fokus" and 1,350 rows with EAR < 0.21 marked
 * "Fokus" — all mechanically correct (duration not yet met) but guaranteed to
 * mislead anyone reading the file as (features, ground truth). Nesting derived
 * state under `classification` makes that misreading structurally hard.
 *
 * PRIVACY INVARIANT (enforced, not merely documented):
 * no frame, ImageData, canvas, blob, or data URL is ever retained. Only
 * derived numbers. Verified by _assertNoImageData on every record.
 */

const FORBIDDEN_KEYS = new Set([
  'image', 'frame', 'imageData', 'bitmap', 'canvas', 'video',
  'dataUrl', 'dataURL', 'blob', 'pixels', 'buffer', 'src',
]);

export class TelemetryLogger {
  /** @param {import('../config.js').CONFIG} config */
  constructor(config) {
    this.config = config;
    this.frames = [];
    this.sessionMeta = null;
    this.droppedCount = 0;
    this._detach = null;
    this.beginSession();
  }

  /**
   * Subscribe to a HachikoAI instance's frame stream.
   *
   * @param {{onFrame:Function, getSessionInfo?:Function}} ai
   * @param {Object} [meta] extra session metadata (device, tester, lighting…)
   * @returns {() => void} detach
   */
  attach(ai, meta = {}) {
    this.detach();
    // Pull provenance from the AI so a replayed log is tied to the exact
    // thresholds that produced it.
    const info = typeof ai.getSessionInfo === 'function' ? ai.getSessionInfo() : {};
    this.beginSession({ ...info, ...meta });
    const unsubscribe = ai.onFrame((frame) => this.record(frame));
    this._detach = () => { unsubscribe(); this._detach = null; };
    return this._detach;
  }

  detach() {
    if (this._detach) this._detach();
  }

  beginSession(meta = {}) {
    this.frames = [];
    this.droppedCount = 0;
    this.sessionMeta = {
      startedAtIso: new Date().toISOString(),
      schemaVersion: 'hachiko-ai-v0.2',
      ...meta,
    };
  }

  /**
   * Record one frame.
   * @param {import('../types.js').TelemetryFrame} frame
   */
  record(frame) {
    if (!this.config.telemetry.enabled) return;
    this._assertNoImageData(frame);

    this.frames.push(frame);
    if (this.frames.length > this.config.telemetry.maxFrames) {
      this.frames.shift();
      this.droppedCount += 1;
    }
  }

  /**
   * Runtime guard for the privacy invariant. Throws loudly rather than silently
   * persisting imagery — a bug here would be a safeguarding problem, not a
   * cosmetic one, given the target users are minors.
   */
  _assertNoImageData(obj, depth = 0) {
    if (depth > 4 || obj === null || typeof obj !== 'object') return;

    if (
      (typeof ImageData !== 'undefined' && obj instanceof ImageData) ||
      (typeof Blob !== 'undefined' && obj instanceof Blob) ||
      (typeof ArrayBuffer !== 'undefined' && obj instanceof ArrayBuffer) ||
      ArrayBuffer.isView(obj)
    ) {
      throw new Error('TelemetryLogger: refusing to store image/binary data');
    }

    for (const [key, value] of Object.entries(obj)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new Error(`TelemetryLogger: forbidden key "${key}" in telemetry`);
      }
      if (value && typeof value === 'object') {
        this._assertNoImageData(value, depth + 1);
      }
    }
  }

  getFrames() {
    return this.frames;
  }

  get length() {
    return this.frames.length;
  }

  latest() {
    return this.frames.length ? this.frames[this.frames.length - 1] : null;
  }

  /**
   * Flat CSV for spreadsheet analysis.
   *
   * Column names carry their provenance: `m_` = raw measurement, `c_` =
   * calibrated, `t_` = temporal/smoothed, `d_` = DERIVED (engine output, NOT
   * ground truth), `p_` = performance. The `d_` prefix is the schema-level
   * warning the old CSV lacked.
   */
  toCSV() {
    const header = [
      'timestampMs',
      // m_ = RAW MEASUREMENT
      'm_facePresent', 'm_poseValid', 'm_poseInvalidReason',
      'm_yawRaw', 'm_pitchRaw', 'm_rollRaw',
      'm_earLeft', 'm_earRight', 'm_earMean',
      // c_ = CALIBRATED (relative to this session's baseline)
      'c_yawDelta', 'c_pitchDelta', 'c_rollDelta', 'c_earRelative',
      // t_ = TEMPORAL (smoothed / accumulated)
      't_yawSmoothed', 't_pitchSmoothed', 't_rollSmoothed', 't_earSmoothed',
      't_absenceEvidenceMs',
      // e_ = EVIDENCE (sustained flags; *_support can never trigger TERALIH)
      'e_yawStrong', 'e_pitchUpStrong', 'e_eyeClosureStrong',
      'e_pitchDownSupport', 'e_rollSupport',
      'e_eyeEligible', 'e_eyeIneligibleReason',
      // d_ = DERIVED PREDICTION — NOT ground truth
      'd_state', 'd_primaryReason', 'd_stateDurationMs', 'd_holding',
      'v_signalValid', 'v_calibrationValid',
      'p_inferenceMs', 'p_fps',
      // g_ = GROUND TRUTH (human annotation, never an engine input)
      'g_manualScenarioTruth',
    ];

    const num = (v, dp = 4) =>
      typeof v === 'number' && Number.isFinite(v) ? v.toFixed(dp) : '';
    const bit = (v) => (v ? 1 : 0);

    const lines = [header.join(',')];
    for (const f of this.frames) {
      const m = f.measurement, c = f.calibrated, t = f.temporal;
      const d = f.classification, p = f.performance, v = f.validity ?? {};
      const e = (f.evidence && f.evidence.active) ? f.evidence.active : {};
      lines.push([
        Math.round(f.timestampMs),
        bit(m.facePresent), bit(m.poseValid), m.poseInvalidReason ?? '',
        num(m.yawRaw, 2), num(m.pitchRaw, 2), num(m.rollRaw, 2),
        num(m.earLeft), num(m.earRight), num(m.earMean),
        num(c.yawDelta, 2), num(c.pitchDelta, 2), num(c.rollDelta, 2), num(c.earRelative),
        num(t.yawSmoothed, 2), num(t.pitchSmoothed, 2), num(t.rollSmoothed, 2),
        num(t.earSmoothed), Math.round(t.faceMissingMs ?? 0),
        bit(e.yawStrong), bit(e.pitchUpStrong), bit(e.eyeClosureStrong),
        bit(e.pitchDownSupport), bit(e.rollSupport),
        bit(f.evidence?.eyeEligible), f.evidence?.eyeIneligibleReason ?? '',
        d.state, d.primaryReason ?? d.reason,
        Math.round(d.stateDurationMs ?? 0), bit(d.holding),
        bit(v.signalValid), bit(v.calibrationValid),
        num(p.inferenceMs, 2), num(p.fps, 1),
        f.manualScenarioTruth ?? 'NONE',
      ].join(','));
    }
    return lines.join('\n');
  }

  /** Full session as JSON, for v0.2 replay. */
  toJSON() {
    return JSON.stringify(
      { meta: this.sessionMeta, droppedCount: this.droppedCount, frames: this.frames },
      null, 2
    );
  }

  /**
   * Offline analysis pack for the acceptance report (section 11).
   *
   * Computes signal distributions, state durations, transition counts,
   * detection delay, and — where a manual ground-truth label exists — the
   * truth-vs-prediction agreement that identifies false TERALIH and false
   * TIDAK_HADIR.
   *
   * Kept here rather than in a notebook so v0.2 acceptance is reproducible.
   */
  analyze() {
    const n = this.frames.length;
    if (n === 0) return { frames: 0 };

    const pct = (arr, p) => {
      if (arr.length === 0) return null;
      const s = [...arr].sort((a, b) => a - b);
      const i = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))));
      return s[i];
    };
    const dist = (values) => {
      const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
      if (clean.length === 0) return null;
      return {
        n: clean.length,
        min: pct(clean, 0), p05: pct(clean, 0.05), p50: pct(clean, 0.5),
        p95: pct(clean, 0.95), max: pct(clean, 1),
        mean: clean.reduce((a, b) => a + b, 0) / clean.length,
      };
    };

    const pick = (fn) => this.frames.map(fn);

    // ── Transitions and state durations ────────────────────────────────
    const transitions = [];
    const stateDurations = {};
    let runStart = this.frames[0].timestampMs;
    for (let i = 1; i < n; i++) {
      const prev = this.frames[i - 1].classification.state;
      const cur = this.frames[i].classification.state;
      if (cur !== prev) {
        transitions.push({
          atMs: this.frames[i].timestampMs,
          from: prev, to: cur,
          reason: this.frames[i].classification.primaryReason,
          truth: this.frames[i].manualScenarioTruth ?? 'NONE',
        });
        (stateDurations[prev] ??= []).push(this.frames[i].timestampMs - runStart);
        runStart = this.frames[i].timestampMs;
      }
    }
    (stateDurations[this.frames[n - 1].classification.state] ??= [])
      .push(this.frames[n - 1].timestampMs - runStart);

    // ── Ground truth vs prediction ─────────────────────────────────────
    // Only frames carrying a manual label participate. Absent labels, the
    // confusion section is empty rather than guessed.
    const byTruth = {};
    for (const f of this.frames) {
      const truth = f.manualScenarioTruth ?? 'NONE';
      if (truth === 'NONE') continue;
      const bucket = (byTruth[truth] ??= { frames: 0, states: {}, reasons: {} });
      bucket.frames++;
      const st = f.classification.state;
      bucket.states[st] = (bucket.states[st] ?? 0) + 1;
      const rs = f.classification.primaryReason ?? f.classification.reason;
      if (rs && rs !== 'NONE') bucket.reasons[rs] = (bucket.reasons[rs] ?? 0) + 1;
    }

    // Detection delay: time from the start of a labelled episode to the first
    // frame where the state LEAVES FOKUS.
    //
    // An episode that begins already out of FOKUS is carry-over from the
    // previous scenario (the state has not recovered yet), not a detection.
    // Recording it would report a spurious 0 ms, so such episodes are skipped
    // and instead reported as `carryOverMs` — how long recovery took.
    const detectionDelays = [];
    const recoveries = [];
    let epTruth = null, epStart = null, epSettled = true, epDone = false;
    for (const f of this.frames) {
      const truth = f.manualScenarioTruth ?? 'NONE';
      const inFokus = f.classification.state === 'FOKUS';
      if (truth !== epTruth) {
        epTruth = truth;
        epStart = f.timestampMs;
        epDone = false;
        // Only a detection if the episode STARTS settled in FOKUS.
        epSettled = inFokus;
      }
      if (epDone || truth === 'NONE') continue;
      if (!epSettled) {
        // Waiting for the carried-over state to clear.
        if (inFokus) {
          recoveries.push({ truth, carryOverMs: f.timestampMs - epStart });
          epSettled = true;
          epStart = f.timestampMs;   // detection clock starts once settled
        }
        continue;
      }
      if (!inFokus) {
        detectionDelays.push({
          truth, delayMs: f.timestampMs - epStart, state: f.classification.state,
        });
        epDone = true;
      }
    }

    return {
      frames: n,
      durationMs: this.frames[n - 1].timestampMs - this.frames[0].timestampMs,
      distributions: {
        yawDelta: dist(pick((f) => f.calibrated.yawDelta)),
        pitchDelta: dist(pick((f) => f.calibrated.pitchDelta)),
        rollDelta: dist(pick((f) => f.calibrated.rollDelta)),
        earMean: dist(pick((f) => f.measurement.earMean)),
        earRelative: dist(pick((f) => f.calibrated.earRelative)),
        inferenceMs: dist(pick((f) => f.performance.inferenceMs)),
        fps: dist(pick((f) => f.performance.fps)),
      },
      transitionCount: transitions.length,
      transitions,
      stateDurationMs: Object.fromEntries(
        Object.entries(stateDurations).map(([k, v]) => [k, dist(v)])
      ),
      groundTruth: byTruth,
      detectionDelays,
      recoveries,
    };
  }

  /** Aggregate stats for the acceptance report. */
  summary() {
    const n = this.frames.length;
    if (n === 0) return { frames: 0 };

    const byState = {};
    const byReason = {};
    let faceFrames = 0, poseValidFrames = 0;
    let fpsSum = 0, fpsCount = 0, infSum = 0, infCount = 0;

    for (const f of this.frames) {
      byState[f.classification.state] = (byState[f.classification.state] ?? 0) + 1;
      const rs = f.classification.primaryReason ?? f.classification.reason;
      byReason[rs] = (byReason[rs] ?? 0) + 1;
      if (f.measurement.facePresent) faceFrames++;
      if (f.measurement.poseValid) poseValidFrames++;
      if (Number.isFinite(f.performance.fps) && f.performance.fps > 0) {
        fpsSum += f.performance.fps; fpsCount++;
      }
      if (Number.isFinite(f.performance.inferenceMs)) {
        infSum += f.performance.inferenceMs; infCount++;
      }
    }

    const durationMs =
      this.frames[n - 1].timestampMs - this.frames[0].timestampMs;

    return {
      frames: n,
      durationMs,
      byState,
      byReason,
      facePresentRatio: faceFrames / n,
      poseValidRatio: poseValidFrames / n,
      meanFps: fpsCount ? fpsSum / fpsCount : null,
      meanInferenceMs: infCount ? infSum / infCount : null,
      droppedCount: this.droppedCount,
    };
  }
}

export default TelemetryLogger;
