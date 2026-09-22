/**
 * Production YOLO26n runtime — LiteRT.js inference for the frozen detector.
 *
 * ── PROVENANCE ───────────────────────────────────────────────────────────
 * Derived from AI-Engine `tools/benchmark/yoloAdapter.js` at frozen commit
 * `c474982`. The class resolution, the canonical detection mapping and the
 * confidence semantics are logically equivalent to the benchmark adapter, so
 * the product measures what Perception DEVELOPMENT measured.
 *
 * What was deliberately LEFT BEHIND: candidate registry lookups, trial
 * bookkeeping, warm-up/p50 latency accounting, model-size and checksum
 * metadata, and the research provenance fields. Those exist to compare
 * candidates; the product has one frozen model and no comparison to make.
 *
 * Production must never import from `tools/benchmark/` — that is research
 * tooling, not shipped code. `src/ai/**` stays under the VENDORED.md
 * contract, so this product-specific runtime glue lives here instead.
 *
 * ── WHY A SECOND RUNTIME ─────────────────────────────────────────────────
 * Every other model HACHIKO loads is MediaPipe Tasks Vision. YOLO26n is a
 * LiteRT artefact and does not satisfy MediaPipe ObjectDetector's tensor and
 * metadata contract, so it runs through the official `@ultralytics/yolo`
 * package on LiteRT.js. Only the ENGINE differs: the accepted confidence,
 * the class mapping and the detection shape are identical either way.
 *
 * No decode, NMS or letterbox arithmetic is reimplemented here. The official
 * package does all of that in shared Rust; a second implementation would be a
 * second source of truth for the same detections.
 */

/** Canonical HACHIKO target classes, by COCO name. */
export const PERSON_LABEL = 'person'
export const PHONE_LABEL = 'cell phone'

export interface ClassIds {
  personId: number
  phoneId: number
}

export interface ResolvedClassIds extends ClassIds {
  /** Disagreements between the model's own map and the frozen config. */
  mismatches: string[]
}

/** One detection in the shape the vendored ObjectDetectorEngine consumes. */
export interface CanonicalDetection {
  index: number
  categoryName: string
  displayName: string
  score: number
  isPerson: boolean
  isPhone: boolean
  boundingBox: {
    originX: number
    originY: number
    width: number
    height: number
  } | null
}

export interface CanonicalObservation {
  task: 'object'
  rawCount: number
  detections: CanonicalDetection[]
  personDetected: boolean
  personMaxScore: number | null
  phoneDetected: boolean
  phoneMaxScore: number | null
  topOther: CanonicalDetection[]
  engineInferenceMs?: number
}

/** The subset of the Ultralytics `Results` shape this module reads. */
interface YoloBox {
  x1: number
  y1: number
  x2: number
  y2: number
  conf: number
  cls: number
  name: string
}

interface YoloResults {
  boxes?: YoloBox[]
  speed?: { preprocess: number; inference: number; postprocess: number }
}

interface YoloModel {
  names: Record<number | string, string>
  device: string
  task: string
  predict(image: unknown, options?: { conf?: number; iou?: number }): Promise<YoloResults>
  free?(): void
}

export interface YoloLoader {
  load(source: unknown, options?: Record<string, unknown>): Promise<YoloModel>
}

/**
 * Resolve person/phone class ids from the model's OWN `names` map.
 *
 * The frozen config's indices are an EXPECTATION, never the answer: if the
 * loaded model disagrees, the model wins and the mismatch is reported.
 *
 * This matters more than it looks. A wrong phone index does not fail loudly —
 * COCO-80 index 76 is `scissors`, a perfectly valid class — so a stale value
 * would quietly score scissors as a phone for an entire session.
 */
export function resolveClassIds(
  names: Record<number | string, string> | null | undefined,
  expected?: { PERSON: number; PHONE: number } | null,
): ResolvedClassIds {
  if (!names || typeof names !== 'object') {
    throw new Error('yolo: model exposed no class names to resolve against')
  }
  const find = (label: string): number | null => {
    for (const [id, name] of Object.entries(names)) {
      if (String(name).toLowerCase() === label) return Number(id)
    }
    return null
  }
  const personId = find(PERSON_LABEL)
  const phoneId = find(PHONE_LABEL)
  if (personId === null) throw new Error('yolo: model has no "person" class')
  if (phoneId === null) throw new Error('yolo: model has no "cell phone" class')

  const mismatches: string[] = []
  if (expected) {
    if (expected.PERSON !== personId) {
      mismatches.push(`person: config ${expected.PERSON}, model ${personId}`)
    }
    if (expected.PHONE !== phoneId) {
      mismatches.push(`phone: config ${expected.PHONE}, model ${phoneId}`)
    }
  }
  return { personId, phoneId, mismatches }
}

/**
 * Map an Ultralytics `Results` onto the canonical observation.
 *
 * Scores pass through UNCHANGED. A 0.80 from YOLO is not a 0.80 from
 * EfficientDet, and rescaling them to look comparable would manufacture a
 * comparison nobody measured.
 */
export function toCanonicalObservation(
  results: YoloResults | null | undefined,
  ids: ClassIds,
): CanonicalObservation {
  const boxes = Array.isArray(results?.boxes) ? results!.boxes! : []
  const flat: CanonicalDetection[] = []
  let personMax: number | null = null
  let phoneMax: number | null = null

  for (const b of boxes) {
    if (!b || typeof b.conf !== 'number' || !Number.isFinite(b.conf)) continue
    const cls = Number(b.cls)
    // Resolve by id first; the name is a fallback for an export whose ids
    // shifted, and never the other way round.
    const name = typeof b.name === 'string' ? b.name : ''
    const isPerson = cls === ids.personId || name.toLowerCase() === PERSON_LABEL
    const isPhone = cls === ids.phoneId || name.toLowerCase() === PHONE_LABEL

    if (isPerson && (personMax === null || b.conf > personMax)) personMax = b.conf
    if (isPhone && (phoneMax === null || b.conf > phoneMax)) phoneMax = b.conf

    flat.push({
      index: cls,
      categoryName: name,
      displayName: '',
      score: b.conf,
      isPerson,
      isPhone,
      // xyxy -> the origin/width/height form the engine expects.
      boundingBox: [b.x1, b.y1, b.x2, b.y2].every(Number.isFinite)
        ? { originX: b.x1, originY: b.y1, width: b.x2 - b.x1, height: b.y2 - b.y1 }
        : null,
    })
  }
  flat.sort((a, b) => b.score - a.score)

  return {
    task: 'object',
    rawCount: boxes.length,
    detections: flat,
    personDetected: personMax !== null,
    personMaxScore: personMax,
    phoneDetected: phoneMax !== null,
    phoneMaxScore: phoneMax,
    // Every OTHER class YOLO can see is ignored for HACHIKO's two questions,
    // but the strongest few are kept so a reader can see what the target
    // classes competed against.
    topOther: flat.filter((d) => !d.isPerson && !d.isPhone).slice(0, 5),
  }
}

export interface YoloRuntimeMeta {
  runtime: 'litert.js'
  /** The backend that ACTUALLY ran, read back from the model. */
  delegate: string | null
  modelTask: string | null
  classCount: number
  personClassId: number
  phoneClassId: number
  labelIndexMismatches: string[]
}

/**
 * A loaded YOLO model, wrapped so the vendored engine never sees the runtime.
 *
 * Mirrors the shape `ObjectDetectorEngine._initializeYolo` expects: a static
 * `load`, an `observe`, a `describe` and a `free`.
 */
export class YoloRuntimeModel {
  private readonly model: YoloModel
  private readonly ids: ClassIds
  private readonly meta: YoloRuntimeMeta

  private constructor(model: YoloModel, ids: ClassIds, meta: YoloRuntimeMeta) {
    this.model = model
    this.ids = ids
    this.meta = meta
  }

  /**
   * @param deps      { YOLO } the official package, injected
   * @param modelUrl  served path to the frozen `.tflite`
   * @param candidate frozen config, for the class-index cross-check
   */
  static async load(
    deps: { YOLO?: YoloLoader },
    modelUrl: string,
    candidate: { labelIndices?: { PERSON: number; PHONE: number } } | null,
    options: { device?: string; litertWasmUrl?: string | null } = {},
  ): Promise<YoloRuntimeModel> {
    const YOLO = deps?.YOLO
    if (!YOLO) throw new Error('yolo: @ultralytics/yolo not provided')

    const model = await YOLO.load(modelUrl, {
      // "auto" takes WebGPU when the adapter works and falls back to CPU.
      // What actually ran is read back below rather than assumed.
      device: options.device ?? 'auto',
      ...(options.litertWasmUrl ? { litertWasmUrl: options.litertWasmUrl } : {}),
    })

    const { personId, phoneId, mismatches } = resolveClassIds(
      model.names,
      candidate?.labelIndices ?? null,
    )

    return new YoloRuntimeModel(model, { personId, phoneId }, {
      runtime: 'litert.js',
      delegate: model.device ?? null,
      modelTask: model.task ?? null,
      classCount: Object.keys(model.names ?? {}).length,
      personClassId: personId,
      phoneClassId: phoneId,
      labelIndexMismatches: mismatches,
    })
  }

  /** One inference on the current frame, as a canonical observation. */
  async observe(
    frame: unknown,
    options: { conf?: number; iou?: number } = {},
  ): Promise<CanonicalObservation> {
    const results = await this.model.predict(frame, {
      // The engine passes the frozen model floor; never a softer cut-off.
      conf: options.conf ?? 0.3,
      iou: options.iou ?? 0.7,
    })
    const obs = toCanonicalObservation(results, this.ids)
    // The engine's own inference timing, excluding pre/post-processing, so
    // it means the same thing the benchmark reported.
    if (results?.speed && Number.isFinite(results.speed.inference)) {
      obs.engineInferenceMs = results.speed.inference
    }
    return obs
  }

  describe(): YoloRuntimeMeta {
    return { ...this.meta }
  }

  free(): void {
    this.model?.free?.()
  }
}

export default YoloRuntimeModel
