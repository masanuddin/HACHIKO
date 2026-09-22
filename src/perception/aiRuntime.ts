import { FilesetResolver, FaceLandmarker, ObjectDetector } from '@mediapipe/tasks-vision'
import { YOLO } from '@ultralytics/yolo'
import { FaceLandmarkerEngine, HachikoAI, ObjectDetectorEngine, withOverrides } from '../ai/index.js'
import { YoloRuntimeModel } from './yoloRuntime'

/**
 * Host-side construction of the vendored AI-Engine runtime. This is the ONLY
 * place HACHIKO instantiates AI-Engine components; nothing else imports the
 * vendored core directly.
 *
 * The AI core does not own the camera and does not import MediaPipe - both
 * MediaPipe classes and every asset path are injected here, per the AI-Engine
 * dependency-injection contract.
 */

export const WASM_PATH = '/wasm'
export const FACE_MODEL_PATH = '/models/face_landmarker.task'
/**
 * PRODUCTION object detector, frozen by Perception DEVELOPMENT (270 evaluable
 * trials): YOLO26n w8a32, serving Person AND Phone from one inference.
 *
 * This previously pointed at `edl2_float16.tflite`, which SILENTLY DEFEATED
 * the freeze: the vendored config named YOLO while the host override handed
 * the engine an EfficientDet asset, so the product ran a model the freeze had
 * not selected. The override now matches the frozen config rather than
 * contradicting it.
 */
export const OBJECT_MODEL_PATH = '/models/yolo26n_w8a32.tflite'
/**
 * LiteRT.js wasm, self-hosted. `@litertjs/core` would otherwise start its
 * worker from a CDN, which a cross-origin-isolated page blocks.
 */
export const LITERT_WASM_PATH = '/wasm/litertjs/'

/**
 * Object inference cadence for the first integrated build. The AI-Engine
 * internal default is 150 ms; HACHIKO targets a mid-range laptop and phone
 * evidence already uses long persistence, so the host pins the cadence to
 * the previous runtime's 1 s via the AI-Engine config override mechanism
 * (no vendored file edited).
 */
export const OBJECT_INFERENCE_INTERVAL_MS = 1000

export interface AiRuntime {
  ai: HachikoAI
  faceEngine: FaceLandmarkerEngine
  objectEngine: ObjectDetectorEngine
}

export async function createAiRuntime(): Promise<AiRuntime> {
  const config = withOverrides({
    objectDetector: { OBJECT_INFERENCE_INTERVAL_MS },
  })

  const ai = new HachikoAI(config)

  // Built as locals rather than inline literals: the vendored engine
  // constructors type their injected deps from JSDoc, and a local keeps the
  // strict compiler out of the vendor's typing surface.
  const faceEngineDeps = {
    FilesetResolver,
    FaceLandmarker,
    assetPaths: {
      modelAssetPath: FACE_MODEL_PATH,
      wasmPath: WASM_PATH,
    },
  }
  const faceEngine = new FaceLandmarkerEngine(config, faceEngineDeps)

  // The vendored engine selects its runtime from `config.objectDetector.runtime`
  // ('litert.js' after the perception freeze). MediaPipe classes stay injected
  // so the engine's MediaPipe branch remains available to debug tooling; the
  // frozen config is what decides which branch actually runs.
  const objectEngineDeps = {
    FilesetResolver,
    ObjectDetector,
    YOLO,
    YoloBenchmarkModel: YoloRuntimeModel,
    assetPaths: {
      objectModelAssetPath: OBJECT_MODEL_PATH,
      wasmPath: WASM_PATH,
      litertWasmPath: LITERT_WASM_PATH,
    },
  }
  const objectEngine = new ObjectDetectorEngine(config, objectEngineDeps)

  await Promise.all([faceEngine.initialize(), objectEngine.initialize()])
  return { ai, faceEngine, objectEngine }
}
