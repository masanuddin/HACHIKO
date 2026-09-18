import { FilesetResolver, FaceLandmarker, ObjectDetector } from '@mediapipe/tasks-vision'
import { FaceLandmarkerEngine, HachikoAI, ObjectDetectorEngine, withOverrides } from '../ai/index.js'

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
// FINAL object-detector model decision (Phase 2). Injected so the vendored
// config.js defaults stay untouched.
export const OBJECT_MODEL_PATH = '/models/edl2_float16.tflite'

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

  const objectEngineDeps = {
    FilesetResolver,
    ObjectDetector,
    assetPaths: {
      objectModelAssetPath: OBJECT_MODEL_PATH,
      wasmPath: WASM_PATH,
    },
  }
  const objectEngine = new ObjectDetectorEngine(config, objectEngineDeps)

  await Promise.all([faceEngine.initialize(), objectEngine.initialize()])
  return { ai, faceEngine, objectEngine }
}
