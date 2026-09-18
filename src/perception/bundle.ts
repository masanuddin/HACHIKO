import type { FaceDetector } from '@mediapipe/tasks-vision'
import type { FaceLandmarkerEngine, HachikoAI, ObjectDetectorEngine } from '../ai/index.js'
import type { CameraSession } from './camera'

/**
 * Everything downstream screens (calibration, session) need, created once in
 * framing.ts. The AI-Engine runtime is the single production perception
 * source; faceDetector (BlazeFace) is UI-only - the calibration preview and
 * mentor bounding box - and never feeds the FocusEngine.
 */
export interface PerceptionBundle {
  camera: CameraSession
  ai: HachikoAI
  faceEngine: FaceLandmarkerEngine
  objectEngine: ObjectDetectorEngine
  faceDetector: FaceDetector
}
