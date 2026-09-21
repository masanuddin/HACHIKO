/**
 * HACHIKO — YOLO26n benchmark adapter  (tools/benchmark)
 * ======================================================
 * EXPERIMENTAL. Lives outside src/ai and is never imported by production code.
 * Nothing here can affect PresenceFusion, PhoneEventTracker, or state.
 *
 * ── WHY A SECOND RUNTIME ─────────────────────────────────────────────────
 * Every other candidate is a MediaPipe Tasks Vision model, loaded through its
 * ObjectDetector. YOLO26n is not: Ultralytics publishes `.pt` and `.onnx`, and
 * the LiteRT export does not satisfy MediaPipe ObjectDetector's tensor and
 * metadata contract. It therefore runs through the official `@ultralytics/yolo`
 * package on LiteRT.js.
 *
 * That is a difference in ENGINE, not in PROTOCOL. YOLO sees the same camera
 * frames, the same scenarios, the same bounded recording window, the same
 * reference labels and the same evaluability rules as everything else. What
 * legitimately differs — input tensor size, preprocessing, backend — is
 * recorded as metadata rather than hidden, because pretending all candidates
 * consume identical tensors would be a fake fairness.
 *
 * ── WHAT THIS FILE DOES NOT DO ───────────────────────────────────────────
 * No decode, no NMS, no letterbox arithmetic. The official package already
 * does all of that in shared Rust and hands back an Ultralytics `Results`.
 * Re-implementing it here would be a second source of truth for the same
 * numbers. This file only maps that result into HACHIKO's canonical
 * observation shape — the exact shape `_observeObject` produces — so every
 * downstream layer stays runtime-agnostic.
 *
 * ── THE INDEX TRAP, AGAIN ────────────────────────────────────────────────
 * YOLO ships the 80-class COCO set with no background row, so `cell phone` is
 * 67. EfficientDet's 76 resolves to `scissors` here. Indices are therefore
 * resolved against the model's OWN `names` map at load time and the registry
 * value is only a cross-check — see `resolveClassIds`.
 *
 * The official `yolo26n_w8a32.tflite` embeds no label table of its own; the
 * runtime supplies the COCO-80 map for a `detect` model at load. That is
 * still the MODEL's map rather than ours, and it is read back and verified
 * every time, so a future asset with different classes cannot slip through.
 */

/** Canonical HACHIKO target classes, by COCO name. */
export const PERSON_LABEL = 'person';
export const PHONE_LABEL = 'cell phone';

/**
 * Resolve person/phone class ids from the model's own `names` map.
 *
 * The registry's `labelIndices` are treated as an EXPECTATION, never as the
 * answer: if the exported model disagrees, the model wins and the mismatch is
 * reported rather than silently accepted. A wrong phone index does not fail
 * loudly at runtime — it quietly scores `scissors` as a phone for an entire
 * benchmark — so it has to be caught here.
 *
 * @param {Record<number|string,string>} names class id -> name, from the model
 * @param {{PERSON:number, PHONE:number}} [expected] registry cross-check
 * @returns {{personId:number, phoneId:number, mismatches:string[]}}
 */
export function resolveClassIds(names, expected = null) {
  if (!names || typeof names !== 'object') {
    throw new Error('yolo: model exposed no class names to resolve against');
  }
  const find = (label) => {
    for (const [id, name] of Object.entries(names)) {
      if (String(name).toLowerCase() === label) return Number(id);
    }
    return null;
  };
  const personId = find(PERSON_LABEL);
  const phoneId = find(PHONE_LABEL);
  if (personId === null) throw new Error('yolo: model has no "person" class');
  if (phoneId === null) throw new Error('yolo: model has no "cell phone" class');

  const mismatches = [];
  if (expected) {
    if (expected.PERSON !== personId) {
      mismatches.push(`person: registry ${expected.PERSON}, model ${personId}`);
    }
    if (expected.PHONE !== phoneId) {
      mismatches.push(`phone: registry ${expected.PHONE}, model ${phoneId}`);
    }
  }
  return { personId, phoneId, mismatches };
}

/**
 * Map an Ultralytics `Results` onto HACHIKO's canonical observation.
 *
 * Byte-for-byte the shape `BenchmarkRunner._observeObject` returns, so the
 * recorder, the metrics and every export treat YOLO exactly like any other
 * object detector. Scores are passed through UNCHANGED: a 0.80 from YOLO is
 * not a 0.80 from EfficientDet, and normalising them to look comparable would
 * manufacture a comparison nobody measured.
 *
 * @param {{boxes?:Array}} results Ultralytics Results
 * @param {{personId:number, phoneId:number}} ids resolved class ids
 * @returns {Object} canonical observation
 */
export function toCanonicalObservation(results, ids) {
  const boxes = Array.isArray(results?.boxes) ? results.boxes : [];
  const flat = [];
  let personMax = null;
  let phoneMax = null;

  for (const b of boxes) {
    if (!b || typeof b.conf !== 'number' || !Number.isFinite(b.conf)) continue;
    const cls = Number(b.cls);
    // Resolve by id first; the name is a fallback for an export whose ids
    // shifted, and never the other way round.
    const name = typeof b.name === 'string' ? b.name : '';
    const isPerson = cls === ids.personId || name.toLowerCase() === PERSON_LABEL;
    const isPhone = cls === ids.phoneId || name.toLowerCase() === PHONE_LABEL;

    if (isPerson && (personMax === null || b.conf > personMax)) personMax = b.conf;
    if (isPhone && (phoneMax === null || b.conf > phoneMax)) phoneMax = b.conf;

    flat.push({
      index: cls,
      categoryName: name,
      displayName: '',
      score: b.conf,
      isPerson, isPhone,
      // xyxy -> the origin/width/height form every other candidate reports.
      boundingBox: [b.x1, b.y1, b.x2, b.y2].every(Number.isFinite) ? {
        originX: b.x1, originY: b.y1,
        width: b.x2 - b.x1, height: b.y2 - b.y1,
      } : null,
    });
  }
  flat.sort((a, b) => b.score - a.score);

  return {
    task: 'object',
    rawCount: boxes.length,
    detections: flat,
    personDetected: personMax !== null,
    personMaxScore: personMax,
    phoneDetected: phoneMax !== null,
    phoneMaxScore: phoneMax,
    // Every OTHER class YOLO can see is ignored for the benchmark decision —
    // HACHIKO asks two questions only — but the strongest few are kept so a
    // reader can see what the target classes competed against.
    topOther: flat.filter((d) => !d.isPerson && !d.isPhone).slice(0, 5),
  };
}

/**
 * A loaded YOLO candidate, wrapped so BenchmarkRunner never sees the engine.
 *
 * Timing note: `load()` and the warm-up pass happen BEFORE any trial can be
 * recorded, and their cost is reported separately. Folding a one-off
 * initialisation into p50 would misreport every candidate and punish the
 * heaviest one hardest, which is the opposite of a feasibility measurement.
 */
export class YoloBenchmarkModel {
  constructor(model, ids, meta) {
    this.model = model;
    this.ids = ids;
    this.meta = meta;
  }

  /**
   * Load the LiteRT artefact and resolve its classes.
   *
   * @param {Object} deps        { YOLO } — the official package, injected
   * @param {string} modelUrl    served path to the `.tflite`
   * @param {Object} candidate   registry entry, for the index cross-check
   * @param {Object} [options]   { device, litertWasmUrl, now }
   */
  static async load(deps, modelUrl, candidate, options = {}) {
    const { YOLO } = deps ?? {};
    if (!YOLO) throw new Error('yolo: @ultralytics/yolo not provided');
    const now = options.now ?? (() => Date.now());

    const t0 = now();
    const model = await YOLO.load(modelUrl, {
      // "auto" takes WebGPU when the adapter works and falls back to CPU/wasm.
      // We read back what ACTUALLY ran rather than recording the request.
      device: options.device ?? 'auto',
      ...(options.litertWasmUrl ? { litertWasmUrl: options.litertWasmUrl } : {}),
    });
    const modelLoadMs = now() - t0;

    const { personId, phoneId, mismatches } =
      resolveClassIds(model.names, candidate?.labelIndices ?? null);

    return new YoloBenchmarkModel(model, { personId, phoneId }, {
      modelId: candidate?.id ?? 'yolo26n',
      runtime: 'litert.js',
      // The backend that ran, not the one we asked for.
      delegate: model.device ?? null,
      modelTask: model.task ?? null,
      inputWidth: candidate?.inputWidth ?? null,
      inputHeight: candidate?.inputHeight ?? null,
      sizeBytes: candidate?.sizeBytes ?? null,
      sourceRepo: candidate?.sourceRepo ?? null,
      sourceRelease: candidate?.sourceRelease ?? null,
      sourceAsset: candidate?.sourceAsset ?? null,
      sha256: candidate?.sha256 ?? null,
      quantization: candidate?.quantization ?? null,
      exportToolVersion: candidate?.exportToolVersion ?? null,
      browserRuntimeVersion: candidate?.browserRuntimeVersion ?? null,
      classCount: Object.keys(model.names ?? {}).length,
      personClassId: personId,
      phoneClassId: phoneId,
      labelIndexMismatches: mismatches,
      modelLoadMs,
      warmupMs: null,
    });
  }

  /**
   * One discarded inference, so the first recorded frame is not the one that
   * paid for shader compilation and buffer allocation.
   */
  async warmup(frame, options = {}) {
    const now = options.now ?? (() => Date.now());
    const t0 = now();
    try {
      await this.model.predict(frame, { conf: options.conf ?? 0.05 });
    } catch (err) {
      // A failed warm-up is a real signal, not something to swallow: the
      // candidate is recorded as unavailable rather than silently replaced.
      throw new Error(`yolo: warm-up failed: ${err?.message ?? err}`);
    }
    this.meta.warmupMs = now() - t0;
    return this.meta.warmupMs;
  }

  /**
   * Steady-state inference on one frame, as a canonical observation.
   *
   * @param {*} frame the SAME camera source every other candidate receives
   * @param {Object} [options] { conf } diagnostic floor, matching the others
   */
  async observe(frame, options = {}) {
    const results = await this.model.predict(frame, {
      // The same diagnostic floor the MediaPipe candidates use, so no
      // candidate is quietly given a more generous cut-off.
      conf: options.conf ?? 0.05,
      iou: options.iou ?? 0.7,
    });
    const obs = toCanonicalObservation(results, this.ids);
    obs.modelId = this.meta.modelId;
    obs.runtime = this.meta.runtime;
    obs.delegate = this.meta.delegate;
    // The engine's own inference timing, excluding pre/post-processing, so it
    // means the same thing as every other candidate's number.
    if (results?.speed && Number.isFinite(results.speed.inference)) {
      obs.engineInferenceMs = results.speed.inference;
    }
    return obs;
  }

  /** Provenance for the export. */
  describe() { return { ...this.meta }; }

  free() { this.model?.free?.(); }
}

export default YoloBenchmarkModel;
