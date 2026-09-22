/**
 * HACHIKO AI v0.3 — ObjectDetectorEngine
 * ======================================
 * Wraps MediaPipe Tasks Vision ObjectDetector for exactly two COCO categories:
 * `person` and `cell phone`.
 *
 * Alongside FaceLandmarkerEngine, this is one of only two modules in the AI
 * core that touch MediaPipe or a video element. Everything downstream consumes
 * plain objects, which keeps the fusion and event logic unit-testable.
 *
 * ── WHY A SECOND MODEL ───────────────────────────────────────────────────
 * Face AI v0.2 is frozen and untouched. It has one architectural limitation
 * confirmed on real hardware: **face not detected != person absent**. A user
 * who turns far enough loses the face detector while their body is plainly
 * visible, and v0.2 eventually reported TIDAK_HADIR. `person` fixes exactly
 * that. `cell phone` is a separate contextual stream that never feeds state.
 *
 * ── CADENCE ──────────────────────────────────────────────────────────────
 * This does NOT run at camera FPS. `shouldRun()` throttles it to
 * OBJECT_INFERENCE_INTERVAL_MS so the face pipeline keeps its ~30 FPS budget.
 * Between ticks the caller reuses the last result, which PresenceFusion is
 * built to tolerate via its tracking hold.
 *
 * PRIVACY: bounding boxes and scores only. No frame, crop, or image is ever
 * retained or emitted.
 */

/** @typedef {import('../types.js').ObjectDetection} ObjectDetection */

export class ObjectDetectorEngine {
  /**
   * @param {import('../config.js').CONFIG} config
   * @param {Object} deps
   * @param {Function} deps.FilesetResolver from @mediapipe/tasks-vision
   * @param {Function} deps.ObjectDetector  from @mediapipe/tasks-vision
   * @param {Object} [deps.assetPaths] host-supplied overrides
   * @param {string} [deps.assetPaths.objectModelAssetPath]
   * @param {string} [deps.assetPaths.wasmPath]
   */
  constructor(config, deps) {
    this.config = config;
    this.deps = deps;
    this.detector = null;
    this.activeDelegate = null;
    this._lastRunMs = null;
    this._lastVideoTimeMs = -1;

    // ── Diagnostics (observation only; never feeds the pipeline) ────────
    this.diagnostics = {
      objectInferenceCount: 0,
      lastObjectInferenceTimestamp: null,
      rawDetectionCount: 0,
      acceptedDetectionCount: 0,
      /** Raw, UNFILTERED detections from the most recent inference. */
      lastRawDetections: [],
      /** Why accepted detections were dropped, so zero is never unexplained. */
      lastRejectReasons: {},
      /** Set once from real output: is runtime categoryName usable at all? */
      categoryNameAvailable: null,
      /** Distinct (index -> name) pairs seen, to verify the label map. */
      observedCategories: {},
      lastInferenceMs: 0,
      lastVideoWidth: null,
      lastVideoHeight: null,
      lastTimestampMs: null,
    };

    const overrides = deps?.assetPaths ?? {};
    this.assetPaths = {
      modelAssetPath:
        overrides.objectModelAssetPath ?? config.objectDetector.modelAssetPath,
      wasmPath: overrides.wasmPath ?? config.landmarker.wasmPath,
      // LiteRT.js wasm for the YOLO path. Null lets the runtime use its own
      // default; a self-hosted path is required on a cross-origin-isolated
      // page, where the worker cannot be started from a CDN.
      litertWasmPath: overrides.litertWasmPath
        ?? config.objectDetector.litertWasmPath ?? null,
    };

    // LiteRT path only: at most one inference in flight, plus the newest
    // completed observation waiting to be consumed by `detect`.
    this.yolo = null;
    this._yoloPending = false;
    this._yoloObs = null;
  }

  /** Load WASM + model, falling back GPU -> CPU like the face engine. */
  async initialize() {
    const cfg = this.config.objectDetector;

    // FROZEN PERCEPTION PATH. YOLO26n is a LiteRT artefact and does not
    // satisfy MediaPipe ObjectDetector's tensor/metadata contract, so it
    // runs through the official @ultralytics/yolo runtime instead. Only the
    // ENGINE differs: the accepted confidence, the class mapping and the
    // detection shape this class emits are identical either way.
    //
    // The MediaPipe branch below is retained for DEVELOPMENT tooling and for
    // any deployment that still injects a MediaPipe detector; production
    // config selects LiteRT.
    if (cfg.runtime === 'litert.js') {
      return this._initializeYolo(cfg);
    }

    const { FilesetResolver, ObjectDetector } = this.deps;
    const fileset = await FilesetResolver.forVisionTasks(this.assetPaths.wasmPath);

    const diagnostic = !!cfg.diagnosticMode;

    const build = async (delegate) => {
      const options = {
        baseOptions: { modelAssetPath: this.assetPaths.modelAssetPath, delegate },
        runningMode: 'VIDEO',
        maxResults: diagnostic ? Math.max(cfg.maxResults, 25) : cfg.maxResults,
        scoreThreshold: diagnostic ? cfg.diagnosticScoreThreshold : cfg.scoreThreshold,
      };
      // In production, restrict at the model boundary so the other 88 COCO
      // classes are never returned. In DIAGNOSTIC mode the allowlist is
      // deliberately omitted: it filters by STRING, so if runtime
      // `categoryName` is empty it silently removes everything before we can
      // inspect it — which would hide the very fault we are looking for.
      if (!diagnostic) {
        options.categoryAllowlist = [...cfg.categoryAllowlist];
      }
      return ObjectDetector.createFromOptions(fileset, options);
    };

    try {
      this.detector = await build(cfg.delegate);
      this.activeDelegate = cfg.delegate;
    } catch (err) {
      if (cfg.delegate === 'GPU') {
        console.warn('[HACHIKO] object detector GPU unavailable, using CPU:', err);
        this.detector = await build('CPU');
        this.activeDelegate = 'CPU';
      } else {
        throw err;
      }
    }
    return this;
  }

  /**
   * Is it time for another object inference?
   * @param {number} nowMs monotonic
   */
  shouldRun(nowMs) {
    if (!this.detector || !this.config.objectDetector.enabled) return false;
    if (this._lastRunMs === null) return true;
    return (nowMs - this._lastRunMs) >= this.config.objectDetector.OBJECT_INFERENCE_INTERVAL_MS;
  }

  /**
   * Run detection on one video frame.
   *
   * @param {HTMLVideoElement} video UNMIRRORED, same element the face engine uses
   * @param {number} nowMs monotonic
   * @returns {{detections:ObjectDetection[], inferenceMs:number, ran:boolean}}
   */
  /**
   * Load the frozen YOLO26n model through the LiteRT runtime.
   *
   * Class ids are re-read from the model's own `names` map and cross-checked
   * against config, because a wrong phone index does not fail loudly — it
   * quietly scores another class as a phone for an entire session.
   */
  async _initializeYolo(cfg) {
    const { YOLO, YoloBenchmarkModel } = this.deps;
    if (!YOLO || !YoloBenchmarkModel) {
      throw new Error('MODEL_INIT_ERROR: the LiteRT runtime '
        + '(@ultralytics/yolo) was not provided to ObjectDetectorEngine');
    }
    this.yolo = await YoloBenchmarkModel.load(this.deps,
      this.assetPaths.modelAssetPath,
      { id: 'yolo26n', labelIndices: cfg.labelIndices,
        inputWidth: 640, inputHeight: 640 },
      { device: cfg.delegate, litertWasmUrl: this.assetPaths.litertWasmPath });

    const meta = this.yolo.describe();
    if (meta.labelIndexMismatches?.length) {
      throw new Error('MODEL_INIT_ERROR: YOLO class map disagrees with the '
        + `frozen config — ${meta.labelIndexMismatches.join('; ')}`);
    }
    this.activeDelegate = meta.delegate ?? null;
    this.detector = this.yolo;          // keeps `initialized` checks truthful
    return true;
  }

  /**
   * One LiteRT inference, kept to a single in-flight request.
   *
   * `detect` is synchronous and cannot await, so the newest completed
   * observation is held here and consumed on the next call. Without the
   * in-flight guard a slow backend would be handed a new frame every tick
   * and fall further behind on each one.
   */
  _pumpYolo(video, nowMs) {
    if (this._yoloPending) return;
    this._yoloPending = true;
    this.yolo.observe(video, { conf: this.config.objectDetector.scoreThreshold })
      .then((obs) => { this._yoloObs = obs; })
      .catch((err) => { console.warn('[HACHIKO] yolo inference failed:', err); })
      .finally(() => { this._yoloPending = false; });
  }

  detect(video, nowMs) {
    if (!this.shouldRun(nowMs)) {
      return { detections: null, inferenceMs: 0, ran: false };
    }
    // VIDEO mode requires strictly increasing timestamps; skip a repeated frame.
    if (video.currentTime === this._lastVideoTimeMs) {
      return { detections: null, inferenceMs: 0, ran: false };
    }
    this._lastVideoTimeMs = video.currentTime;
    this._lastRunMs = nowMs;

    const t0 = performance.now();
    let result;
    let inferenceMs;
    if (this.yolo) {
      // Start the next inference, then take whatever has already landed.
      this._pumpYolo(video, nowMs);
      const obs = this._yoloObs;
      this._yoloObs = null;                 // consume once; never re-read
      if (!obs) return { detections: null, inferenceMs: 0, ran: false };
      // The engine's own timing, so it means the same thing the benchmark
      // reported rather than including the wait for a queued promise.
      inferenceMs = Number.isFinite(obs.engineInferenceMs)
        ? obs.engineInferenceMs : performance.now() - t0;
      // SHAPE ADAPTATION, at the boundary and nowhere else. Everything
      // downstream (diagnostics, normalize, per-category floors) reads the
      // MediaPipe shape `{ categories: [...], boundingBox }`, so the flat
      // adapter detections are re-wrapped here rather than teaching two
      // shapes to every consumer.
      result = {
        detections: (obs.detections ?? []).map((d) => ({
          categories: [{
            index: d.index,
            categoryName: d.categoryName,
            displayName: d.displayName ?? '',
            score: d.score,
          }],
          boundingBox: d.boundingBox,
        })),
      };
    } else {
      try {
        result = this.detector.detectForVideo(video, nowMs);
      } catch (err) {
        console.warn('[HACHIKO] object detectForVideo failed:', err);
        return { detections: [], inferenceMs: performance.now() - t0, ran: true };
      }
      inferenceMs = performance.now() - t0;
    }
    const raw = result?.detections ?? [];

    // Record RAW output before any filtering, so "zero accepted" can always be
    // explained rather than merely observed.
    this._recordDiagnostics(raw, nowMs, inferenceMs, video);

    const detections = this.normalize(raw, nowMs);
    this.diagnostics.acceptedDetectionCount = detections.length;

    return { detections, inferenceMs, ran: true, rawDetections: this.getRawDetections() };
  }

  /** Capture unfiltered model output for inspection. Numbers only, no imagery. */
  _recordDiagnostics(raw, nowMs, inferenceMs, video) {
    const d = this.diagnostics;
    const cfg = this.config.objectDetector;

    d.objectInferenceCount += 1;
    d.lastObjectInferenceTimestamp = nowMs;
    d.rawDetectionCount = raw.length;
    d.lastInferenceMs = inferenceMs;
    d.lastTimestampMs = nowMs;
    d.lastVideoWidth = video?.videoWidth ?? null;
    d.lastVideoHeight = video?.videoHeight ?? null;

    const flat = [];
    for (const det of raw) {
      const top = det?.categories?.[0];
      if (!top) continue;
      const name = typeof top.categoryName === 'string' ? top.categoryName : null;

      // Decide ONCE, from real output, whether the runtime label map works.
      // This is the difference between "the model saw nothing" and "the model
      // saw things we could not name".
      if (d.categoryNameAvailable === null && raw.length > 0) {
        d.categoryNameAvailable = !!(name && name.length > 0);
      }

      const key = `${top.index}:${name ?? ''}`;
      d.observedCategories[key] = (d.observedCategories[key] ?? 0) + 1;

      flat.push({
        index: top.index,
        categoryName: name,
        displayName: top.displayName ?? null,
        score: top.score,
        boundingBox: det.boundingBox
          ? {
              originX: det.boundingBox.originX, originY: det.boundingBox.originY,
              width: det.boundingBox.width, height: det.boundingBox.height,
            }
          : null,
        timestampMs: nowMs,
      });
    }
    flat.sort((a, b) => b.score - a.score);
    d.lastRawDetections = flat.slice(0, cfg.diagnosticMaxRawDetections);
  }

  /** Raw model detections from the most recent inference (diagnostics). */
  getRawDetections() {
    return this.diagnostics.lastRawDetections;
  }

  getDiagnostics() {
    return { ...this.diagnostics, observedCategories: { ...this.diagnostics.observedCategories } };
  }

  /**
   * Convert raw MediaPipe detections into our flat shape and apply per-category
   * confidence. Pure — exported for testing without a model.
   *
   * @param {Array} rawDetections
   * @param {number} nowMs
   * @returns {ObjectDetection[]}
   */
  normalize(rawDetections, nowMs) {
    const cfg = this.config.objectDetector;
    const out = [];
    const reject = {};
    const note = (reason) => { reject[reason] = (reject[reason] ?? 0) + 1; };

    for (const det of rawDetections ?? []) {
      const top = det?.categories?.[0];
      if (!top) { note('NO_CATEGORY'); continue; }

      const confidence = top.score;
      if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
        note('NON_FINITE_SCORE'); continue;
      }

      // ── Identify the class ─────────────────────────────────────────────
      // MediaPipe builds `categoryName` as `labels[index] ?? ""`, so when a
      // model's label map is not wired through at runtime the name is an EMPTY
      // STRING while `index` still carries the true class. Matching only on the
      // name then rejects every detection and looks exactly like "the detector
      // sees nothing" — the Gate-4 symptom. We therefore resolve by name when
      // one is present and fall back to the COCO index when it is not.
      const rawName = typeof top.categoryName === 'string' ? top.categoryName : '';
      const category = this._resolveCategory(rawName, top.index);
      if (!category) {
        note(rawName ? 'OTHER_CATEGORY' : 'UNRESOLVED_CATEGORY');
        continue;
      }

      // Per-category floors. Person is deliberately the more permissive of the
      // two: a missed person can cause a false TIDAK_HADIR, which is the worst
      // failure this whole feature exists to prevent.
      const minConfidence = category === cfg.labels.PERSON
        ? cfg.minPersonConfidence
        : cfg.minPhoneConfidence;

      if (confidence < minConfidence) {
        note(category === cfg.labels.PERSON ? 'PERSON_BELOW_CONFIDENCE' : 'PHONE_BELOW_CONFIDENCE');
        continue;
      }

      const box = det.boundingBox;
      out.push({
        category,
        confidence,
        // MediaPipe returns PIXELS, not normalized coordinates.
        boundingBox: box
          ? {
              originX: box.originX, originY: box.originY,
              width: box.width, height: box.height,
            }
          : null,
        timestampMs: nowMs,
        // Provenance: how this detection was identified.
        resolvedBy: rawName ? 'NAME' : 'INDEX',
        categoryIndex: top.index,
      });
    }

    this.diagnostics.lastRejectReasons = reject;
    return out;
  }

  /**
   * Map a runtime detection to one of our two categories.
   *
   * Name first (authoritative when present), then COCO index as a fallback so
   * a missing/unmapped label map cannot silently zero the pipeline.
   *
   * @param {string} rawName runtime categoryName; may be ''
   * @param {number} index   COCO class index
   * @returns {string|null}  our canonical label, or null if not of interest
   */
  _resolveCategory(rawName, index) {
    const cfg = this.config.objectDetector;
    if (rawName) {
      // Normalise spacing/case so 'Cell Phone' or 'cell_phone' still match.
      const norm = rawName.trim().toLowerCase().replace(/[_-]+/g, ' ');
      if (norm === cfg.labels.PERSON) return cfg.labels.PERSON;
      if (norm === cfg.labels.PHONE) return cfg.labels.PHONE;
      return null;
    }
    if (cfg.matchByIndexWhenNameMissing && typeof index === 'number') {
      if (index === cfg.labelIndices.PERSON) return cfg.labels.PERSON;
      if (index === cfg.labelIndices.PHONE) return cfg.labels.PHONE;
    }
    return null;
  }

  close() {
    // The two runtimes release differently: MediaPipe exposes close(), the
    // LiteRT model exposes free(). Calling the wrong one leaks the wasm
    // module for the lifetime of the page.
    if (this.yolo) {
      this.yolo.free?.();
      this.yolo = null;
      this._yoloObs = null;
      this._yoloPending = false;
      this.detector = null;
      return;
    }
    if (this.detector) {
      this.detector.close();
      this.detector = null;
    }
  }
}

export default ObjectDetectorEngine;
