/**
 * HACHIKO v0.3 — Bake-off runner  (tools/benchmark)
 * =================================================
 * Loads each candidate model against the SAME live webcam frame and records
 * raw, unfiltered output for the scenario matrix.
 *
 * EXPERIMENTAL. Imports nothing from src/ai except types, and is imported by
 * nothing in src/ai. Production perception is entirely unaffected: this runs
 * its own detector instances with their own settings.
 *
 * ── OBSERVATION DISCIPLINE ───────────────────────────────────────────────
 *  - ONE shared diagnostic score floor (0.05) for every candidate, so the
 *    comparison measures the models, not our thresholds.
 *  - NO categoryAllowlist: every class is returned, so we can see what the
 *    target classes are competing against at similar confidence — the exact
 *    symptom reported on EfficientDet-Lite0 INT8.
 *  - Class identity resolved by each model's OWN index map (SSD MobileNetV2
 *    carries a background class at index 0, shifting person to 1 and cell
 *    phone to 77; EfficientDet uses 0 and 76).
 *  - Numbers and boxes only. No frame, crop or image is ever retained.
 */

import {
  CANDIDATES, BENCH_SCORE_THRESHOLD, BENCH_MAX_RESULTS,
} from './candidates.js';

const PERSON = 'person';
const PHONE = 'cell phone';

export class BenchmarkRunner {
  /**
   * @param {Object} deps { FilesetResolver, ObjectDetector, PoseLandmarker }
   * @param {Object} [options]
   * @param {string} [options.wasmPath]
   * @param {string} [options.assetDir] where bench models are served from
   */
  constructor(deps, options = {}) {
    this.deps = deps;
    this.wasmPath = options.wasmPath ?? './assets/wasm';
    this.assetDir = options.assetDir ?? './assets/bench';
    /** @type {Map<string, {candidate:Object, instance:Object, delegate:string}>} */
    this.loaded = new Map();
    this.activeId = null;
    /** Recorded trials, appended by `recordTrial`. */
    this.trials = [];
    this.lastObservation = null;
  }

  /** Candidates this runner knows about. */
  get candidates() { return CANDIDATES; }

  /**
   * Load one candidate. Models are loaded on demand rather than all at once —
   * holding four models resident would distort the latency measurements we are
   * here to collect.
   */
  async load(candidateId) {
    if (this.loaded.has(candidateId)) {
      this.activeId = candidateId;
      return this.loaded.get(candidateId);
    }
    const candidate = CANDIDATES.find((c) => c.id === candidateId);
    if (!candidate) throw new Error(`unknown candidate: ${candidateId}`);

    const { FilesetResolver, ObjectDetector, PoseLandmarker } = this.deps;
    const fileset = await FilesetResolver.forVisionTasks(this.wasmPath);
    const modelAssetPath = `${this.assetDir}/${candidate.file}`;

    const build = async (delegate) => {
      if (candidate.task === 'pose') {
        if (!PoseLandmarker) throw new Error('PoseLandmarker not provided');
        return PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
          // Presence only. Segmentation masks are image data we neither need
          // nor are willing to hold.
          outputSegmentationMasks: false,
        });
      }
      return ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        maxResults: BENCH_MAX_RESULTS,
        scoreThreshold: BENCH_SCORE_THRESHOLD,
        // No categoryAllowlist by design — see header.
      });
    };

    let instance;
    let delegate = candidate.delegate;
    try {
      instance = await build(delegate);
    } catch (err) {
      console.warn(`[bench] ${candidateId} GPU unavailable, falling back to CPU:`, err);
      delegate = 'CPU';
      instance = await build('CPU');
    }

    const entry = { candidate, instance, delegate, lastVideoTime: -1 };
    this.loaded.set(candidateId, entry);
    this.activeId = candidateId;
    return entry;
  }

  /**
   * Run one inference of the active candidate on the current frame.
   * @param {HTMLVideoElement} video UNMIRRORED
   * @param {number} nowMs monotonic
   * @returns {Object|null} observation, or null if the frame was not advanced
   */
  observe(video, nowMs) {
    const entry = this.loaded.get(this.activeId);
    if (!entry) return null;
    // VIDEO mode needs strictly increasing timestamps.
    if (video.currentTime === entry.lastVideoTime) return null;
    entry.lastVideoTime = video.currentTime;

    const t0 = performance.now();
    let observation;
    try {
      observation = entry.candidate.task === 'pose'
        ? this._observePose(entry, video, nowMs)
        : this._observeObject(entry, video, nowMs);
    } catch (err) {
      console.warn('[bench] inference failed:', err);
      return null;
    }
    observation.inferenceMs = performance.now() - t0;
    observation.modelId = entry.candidate.id;
    observation.delegate = entry.delegate;
    observation.timestampMs = nowMs;

    this.lastObservation = observation;
    return observation;
  }

  _observeObject(entry, video, nowMs) {
    const result = entry.instance.detectForVideo(video, nowMs);
    const raw = result?.detections ?? [];
    const idx = entry.candidate.labelIndices;

    const flat = [];
    let personMax = null;
    let phoneMax = null;

    for (const det of raw) {
      const top = det?.categories?.[0];
      if (!top) continue;
      const name = typeof top.categoryName === 'string' ? top.categoryName : '';
      // Resolve by this model's OWN index map, falling back to the name.
      const isPerson = top.index === idx.PERSON || name.toLowerCase() === PERSON;
      const isPhone = top.index === idx.PHONE || name.toLowerCase() === PHONE;

      if (isPerson && (personMax === null || top.score > personMax)) personMax = top.score;
      if (isPhone && (phoneMax === null || top.score > phoneMax)) phoneMax = top.score;

      flat.push({
        index: top.index,
        categoryName: name,
        displayName: top.displayName ?? '',
        score: top.score,
        isPerson, isPhone,
        boundingBox: det.boundingBox ? {
          originX: det.boundingBox.originX, originY: det.boundingBox.originY,
          width: det.boundingBox.width, height: det.boundingBox.height,
        } : null,
      });
    }
    flat.sort((a, b) => b.score - a.score);

    return {
      task: 'object',
      rawCount: raw.length,
      detections: flat,
      personDetected: personMax !== null,
      personMaxScore: personMax,
      phoneDetected: phoneMax !== null,
      phoneMaxScore: phoneMax,
      // What the target classes are competing against — the reported symptom
      // was irrelevant classes appearing at similar confidence.
      topOther: flat.filter((d) => !d.isPerson && !d.isPhone).slice(0, 5),
    };
  }

  _observePose(entry, video, nowMs) {
    const result = entry.instance.detectForVideo(video, nowMs);
    const poses = result?.landmarks ?? [];
    const first = poses[0] ?? null;

    // Presence only: a body was localised or it was not. We deliberately do NOT
    // interpret the landmarks — no posture, no focus, no gaze.
    let visibleLandmarks = 0;
    if (first) {
      for (const lm of first) {
        // `visibility` is present on pose landmarks; treat missing as visible.
        if (lm.visibility === undefined || lm.visibility > 0.5) visibleLandmarks += 1;
      }
    }

    return {
      task: 'pose',
      rawCount: poses.length,
      bodyDetected: poses.length > 0,
      landmarkCount: first ? first.length : 0,
      visibleLandmarks,
      // A crude confidence proxy: fraction of landmarks the model considers
      // visible. Used only for reporting, never for a decision.
      presenceScore: first && first.length ? visibleLandmarks / first.length : null,
      detections: [],
      personDetected: poses.length > 0,
      personMaxScore: first && first.length ? visibleLandmarks / first.length : null,
      phoneDetected: false,
      phoneMaxScore: null,
      topOther: [],
    };
  }

  /**
   * Record a trial for the matrix. Called by the operator once a scenario has
   * been held steady, using the peak observation over the sampling window.
   *
   * @param {Object} input
   * @param {'person'|'phone'|'pose'} input.task
   * @param {string} input.scenarioId
   * @param {boolean} input.expected
   * @param {Object} input.observation  peak observation for the window
   */
  recordTrial({ task, scenarioId, expected, observation }) {
    const detected = task === 'phone'
      ? observation.phoneDetected
      : observation.personDetected;
    const maxScore = task === 'phone'
      ? observation.phoneMaxScore
      : observation.personMaxScore;

    const trial = {
      modelId: observation.modelId,
      task,
      scenarioId,
      expected,
      detected,
      maxScore,
      // On a negative-control scenario, any detection IS the false positive.
      falsePositive: !expected && detected,
      inferenceMs: observation.inferenceMs,
      delegate: observation.delegate,
      recordedAtIso: new Date().toISOString(),
    };
    this.trials.push(trial);
    return trial;
  }

  /**
   * Peak-hold across a sampling window, so a scenario is judged on the model's
   * best opportunity rather than one unlucky frame.
   */
  static peak(observations) {
    if (!observations.length) return null;
    const best = { ...observations[0] };
    for (const o of observations) {
      if ((o.personMaxScore ?? -1) > (best.personMaxScore ?? -1)) {
        best.personMaxScore = o.personMaxScore;
        best.personDetected = o.personDetected;
      }
      if ((o.phoneMaxScore ?? -1) > (best.phoneMaxScore ?? -1)) {
        best.phoneMaxScore = o.phoneMaxScore;
        best.phoneDetected = o.phoneDetected;
      }
    }
    const times = observations.map((o) => o.inferenceMs).sort((a, b) => a - b);
    best.inferenceMs = times[times.length >> 1];
    return best;
  }

  getTrials() { return [...this.trials]; }

  /** Export for offline analysis. Numbers only. */
  toJSON() {
    return JSON.stringify({
      generatedAt: new Date().toISOString(),
      scoreThreshold: BENCH_SCORE_THRESHOLD,
      candidates: CANDIDATES.map(({ id, label, sizeBytes, delegate, labelIndices }) =>
        ({ id, label, sizeBytes, delegate, labelIndices })),
      trials: this.trials,
    }, null, 2);
  }

  close() {
    for (const { instance } of this.loaded.values()) {
      try { instance.close(); } catch { /* already closed */ }
    }
    this.loaded.clear();
    this.activeId = null;
  }
}

export default BenchmarkRunner;
