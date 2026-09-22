/**
 * Frozen perception runtime — does the PRODUCT actually run YOLO26n?
 *
 * Config saying "yolo" proves nothing: before this integration the vendored
 * config named YOLO while the host override handed the engine an EfficientDet
 * asset, so the product ran a model the freeze never selected. These tests
 * therefore check the wiring and the instantiation, not the declaration.
 *
 * No network, no camera, no model file: the official package is injected as a
 * fake so these run anywhere.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  resolveClassIds,
  toCanonicalObservation,
  YoloRuntimeModel,
} from './yoloRuntime'
import { CONFIG } from '../ai/index.js'
import { FACE_MODEL_PATH, OBJECT_MODEL_PATH, LITERT_WASM_PATH } from './aiRuntime'

/** The real 80-class COCO ordering, as YOLO26n reports it. */
const COCO80: Record<number, string> = {
  0: 'person', 1: 'bicycle', 24: 'backpack', 63: 'laptop',
  65: 'remote', 66: 'keyboard', 67: 'cell phone', 73: 'book',
  76: 'scissors', 77: 'teddy bear',
}

const box = (
  cls: number, conf: number, name: string,
  xy: [number, number, number, number] = [0, 0, 10, 10],
) => ({ cls, conf, name, x1: xy[0], y1: xy[1], x2: xy[2], y2: xy[3] })

function fakeYOLO(opts: {
  names?: Record<number, string>
  device?: string
  boxes?: ReturnType<typeof box>[]
  seen?: { conf: number }[]
} = {}) {
  return {
    load: vi.fn(async (_source: unknown, _options?: unknown) => ({
      names: opts.names ?? COCO80,
      device: opts.device ?? 'webgpu',
      task: 'detect',
      predict: async (_f: unknown, o?: { conf?: number }) => {
        if (opts.seen) opts.seen.push({ conf: o?.conf ?? -1 })
        return {
          boxes: opts.boxes ?? [],
          speed: { preprocess: 1, inference: 7, postprocess: 2 },
        }
      },
      free() {},
    })),
  }
}

const OD = CONFIG.objectDetector as {
  runtime: string
  modelAssetPath: string
  labelIndices: { PERSON: number; PHONE: number }
  minPersonConfidence: number
  minPhoneConfidence: number
  scoreThreshold: number
}

describe('frozen perception configuration', () => {
  it('selects YOLO26n as the production runtime', () => {
    expect(OD.runtime).toBe('litert.js')
    expect(OD.modelAssetPath).toMatch(/yolo26n_w8a32\.tflite$/)
  })

  it('uses YOLO class ids, not another model family\'s', () => {
    expect(OD.labelIndices.PERSON).toBe(0)
    expect(OD.labelIndices.PHONE).toBe(67)
    // 76/77 are EfficientDet/SSD phone indices. Under COCO-80, 76 is
    // `scissors` — a stale value would score scissors as a phone silently.
    expect(OD.labelIndices.PHONE).not.toBe(76)
    expect(OD.labelIndices.PHONE).not.toBe(77)
  })

  it('accepts both channels at the frozen 0.30 operating point', () => {
    expect(OD.minPersonConfidence).toBe(0.3)
    expect(OD.minPhoneConfidence).toBe(0.3)
    // The model floor must not sit above the operating point, or detections
    // the operating point accepts would never reach it.
    expect(OD.scoreThreshold).toBeLessThanOrEqual(OD.minPersonConfidence)
  })
})

describe('host wiring: the product must not silently substitute a model', () => {
  it('points the host override at the frozen YOLO asset', () => {
    expect(OBJECT_MODEL_PATH).toBe('/models/yolo26n_w8a32.tflite')
    // The exact regression this guards: an EfficientDet override defeating
    // the freeze while the config still claimed YOLO.
    expect(OBJECT_MODEL_PATH).not.toMatch(/edl|efficientdet/i)
    expect(FACE_MODEL_PATH).toBe('/models/face_landmarker.task')
  })

  it('serves the LiteRT wasm same-origin', () => {
    // A CDN worker breaks the no-network constraint and is blocked outright
    // on a cross-origin-isolated page.
    expect(LITERT_WASM_PATH.startsWith('/')).toBe(true)
    expect(LITERT_WASM_PATH).not.toMatch(/^https?:/)
  })

  it('drives the engine down the LiteRT branch, not MediaPipe', async () => {
    // The real proof: run the VENDORED engine with the frozen config and the
    // host's dependency shape, and confirm it instantiated YOLO. Asserting
    // that config says "yolo" is exactly the check that passed while an
    // EfficientDet override was silently in force.
    const { ObjectDetectorEngine } = await import('../ai/index.js')
    const yolo = fakeYOLO()
    const engine = new (ObjectDetectorEngine as never as new (
      c: unknown, d: unknown,
    ) => {
      initialize(): Promise<unknown>
      activeDelegate: string | null
      yolo: unknown
      detector: unknown
    })(CONFIG, {
      YOLO: yolo,
      YoloBenchmarkModel: YoloRuntimeModel,
      assetPaths: {
        objectModelAssetPath: OBJECT_MODEL_PATH,
        litertWasmPath: LITERT_WASM_PATH,
      },
    })

    await engine.initialize()
    expect(yolo.load).toHaveBeenCalledTimes(1)
    // Loaded from the frozen asset path, not an EfficientDet one.
    expect(yolo.load.mock.calls[0]?.[0]).toBe(OBJECT_MODEL_PATH)
    expect(engine.yolo).toBeTruthy()
    expect(engine.activeDelegate).toBe('webgpu')
  })

  it('refuses to start when the LiteRT runtime is absent', async () => {
    // No silent fallback to MediaPipe: a missing runtime is an explicit
    // failure, so a deployment cannot quietly run an unfrozen model.
    const { ObjectDetectorEngine } = await import('../ai/index.js')
    const engine = new (ObjectDetectorEngine as never as new (
      c: unknown, d: unknown,
    ) => { initialize(): Promise<unknown> })(CONFIG, {
      assetPaths: { objectModelAssetPath: OBJECT_MODEL_PATH },
    })
    await expect(engine.initialize()).rejects.toThrow(/MODEL_INIT_ERROR/)
  })
})

describe('class resolution reads the model, not the config', () => {
  it('resolves person and cell phone from the model\'s own names', () => {
    const r = resolveClassIds(COCO80, OD.labelIndices)
    expect(r.personId).toBe(0)
    expect(r.phoneId).toBe(67)
    expect(r.mismatches).toEqual([])
  })

  it('reports a config index that disagrees with the model', () => {
    const r = resolveClassIds(COCO80, { PERSON: 0, PHONE: 76 })
    expect(r.phoneId).toBe(67)
    expect(r.mismatches).toHaveLength(1)
    expect(r.mismatches[0] ?? '').toMatch(/phone: config 76, model 67/)
  })

  it('refuses a model without the target classes rather than guessing', () => {
    expect(() => resolveClassIds({ 0: 'cat' })).toThrow(/no "person"/)
    expect(() => resolveClassIds({ 0: 'person' })).toThrow(/no "cell phone"/)
    expect(() => resolveClassIds(null)).toThrow(/no class names/)
  })
})

describe('canonical observation parity with the benchmark adapter', () => {
  it('maps person and phone into the engine\'s detection shape', () => {
    const obs = toCanonicalObservation({
      boxes: [
        box(0, 0.93, 'person', [10, 20, 110, 220] as [number, number, number, number]),
        box(67, 0.42, 'cell phone', [5, 5, 25, 45] as [number, number, number, number]),
        box(65, 0.31, 'remote'),
      ],
    }, { personId: 0, phoneId: 67 })

    expect(obs.task).toBe('object')
    expect(obs.personDetected).toBe(true)
    expect(obs.personMaxScore).toBe(0.93)
    expect(obs.phoneDetected).toBe(true)
    expect(obs.phoneMaxScore).toBe(0.42)
    expect(obs.rawCount).toBe(3)
    // xyxy -> origin/width/height, as the engine expects.
    expect(obs.detections.find((d) => d.isPerson)?.boundingBox)
      .toEqual({ originX: 10, originY: 20, width: 100, height: 200 })
    // Strongest first.
    expect(obs.detections.map((d) => d.score)).toEqual([0.93, 0.42, 0.31])
  })

  it('never reads an unrelated class as person or phone', () => {
    const obs = toCanonicalObservation({
      boxes: [box(65, 0.91, 'remote'), box(76, 0.88, 'scissors'),
        box(63, 0.80, 'laptop')],
    }, { personId: 0, phoneId: 67 })
    expect(obs.personDetected).toBe(false)
    expect(obs.phoneDetected).toBe(false)
    expect(obs.topOther).toHaveLength(3)
  })

  it('passes confidences through unscaled', () => {
    const obs = toCanonicalObservation({
      boxes: [box(0, 0.40, 'person'), box(0, 0.88, 'person')],
    }, { personId: 0, phoneId: 67 })
    expect(obs.personMaxScore).toBe(0.88)
    expect(obs.detections.map((d) => d.score)).toEqual([0.88, 0.40])
  })

  it('survives malformed and empty results', () => {
    const bad = toCanonicalObservation({
      boxes: [null as never, {} as never, box(0, NaN, 'person'), box(0, 0.5, 'person')],
    }, { personId: 0, phoneId: 67 })
    expect(bad.detections).toHaveLength(1)

    for (const r of [{ boxes: [] }, {}, null]) {
      const obs = toCanonicalObservation(r, { personId: 0, phoneId: 67 })
      expect(obs.personDetected).toBe(false)
      expect(obs.detections).toHaveLength(0)
    }
  })
})

describe('runtime model lifecycle', () => {
  it('reads back the backend that actually ran', async () => {
    const m = await YoloRuntimeModel.load(
      { YOLO: fakeYOLO({ device: 'cpu' }) }, '/models/yolo26n_w8a32.tflite',
      { labelIndices: OD.labelIndices }, { device: 'auto' })
    const meta = m.describe()
    // We asked for "auto" and got CPU; the report must say CPU.
    expect(meta.delegate).toBe('cpu')
    expect(meta.runtime).toBe('litert.js')
    expect(meta.personClassId).toBe(0)
    expect(meta.phoneClassId).toBe(67)
    expect(meta.labelIndexMismatches).toEqual([])
  })

  it('passes the frozen floor to the model, not a softer one', async () => {
    const seen: { conf: number }[] = []
    const m = await YoloRuntimeModel.load(
      { YOLO: fakeYOLO({ seen }) }, '/m.tflite',
      { labelIndices: OD.labelIndices })
    await m.observe({}, { conf: OD.scoreThreshold })
    expect(seen[0]?.conf).toBe(0.3)
  })

  it('surfaces a missing runtime instead of falling back', async () => {
    await expect(
      YoloRuntimeModel.load({}, '/m.tflite', { labelIndices: OD.labelIndices }),
    ).rejects.toThrow(/@ultralytics\/yolo not provided/)
  })

  it('reports engine inference timing separately from wall time', async () => {
    const m = await YoloRuntimeModel.load(
      { YOLO: fakeYOLO() }, '/m.tflite', { labelIndices: OD.labelIndices })
    const obs = await m.observe({})
    expect(obs.engineInferenceMs).toBe(7)
  })
})
