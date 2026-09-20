import type { FaceDetector } from '@mediapipe/tasks-vision'
import type { FaceLandmarkerEngine, HachikoAI, ObjectDetectorEngine } from '../ai/index.js'
import type { Frame } from '../engine/focusEngine'
import { toFrame, type AiTelemetryFrame } from './aiAdapter'
import { readFaceBox, type FaceBox } from './faceBox'

export interface CameraSession {
  video: HTMLVideoElement
  stream: MediaStream
  stop: () => void
}

/**
 * getUserMedia at 640x480, front camera. Throws with the raw DOMException
 * on denial/no-device - callers render the Indonesian permission-denied
 * copy (see ui/strings.ts), not this module.
 */
export async function startCamera(video: HTMLVideoElement): Promise<CameraSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  })

  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()

  return {
    video,
    stream,
    stop: () => {
      for (const track of stream.getTracks()) track.stop()
      video.srcObject = null
    },
  }
}

export interface AiPerceptionTick {
  timestampMs: number
  /** Adapted frame ready for FocusEngine.step(), one per face-clock tick. */
  frame: Frame
  /** Full AI-Engine telemetry for debugging/instrumentation. */
  telemetry: AiTelemetryFrame
}

export interface PerceptionLoopHandle {
  stop: () => void
}

/**
 * The single production perception loop: camera frame -> AI-Engine face
 * engine -> AI-Engine object engine -> HachikoAI.processFrame ->
 * adapter -> Frame. Runs off `video.requestVideoFrameCallback()` - NOT
 * `requestAnimationFrame`, which throttles (or stops entirely) when the
 * tab loses focus. BUILD_PROMPTS P1's week-1 gate: background the tab for
 * 60s and confirm this keeps firing. The whole laptop premise depends on it.
 *
 * Face inference fires at the face clock (default 5fps); object inference
 * is throttled inside ObjectDetectorEngine by the host-configured cadence
 * (see aiRuntime.ts), never per camera frame.
 */
export function startPerceptionLoop(
  video: HTMLVideoElement,
  ai: HachikoAI,
  faceEngine: FaceLandmarkerEngine,
  objectEngine: ObjectDetectorEngine,
  onTick: (tick: AiPerceptionTick) => void,
  faceIntervalMs = 200,
): PerceptionLoopHandle {
  let stopped = false
  let lastFaceT = -Infinity

  const onFrame: VideoFrameRequestCallback = () => {
    if (stopped) return

    // Not metadata.mediaTime: re-registering requestVideoFrameCallback on
    // a still-live MediaStream (every screen after Framing does exactly
    // this, reusing the same video) can reset or repeat mediaTime values,
    // which breaks MediaPipe's requirement that timestamps always increase.
    // performance.now() is monotonic for the whole page lifetime.
    const timestampMs = Math.round(performance.now())

    // Without this, one thrown error (from either engine) would return
    // before reaching the requestVideoFrameCallback re-registration
    // below, permanently and silently freezing the loop.
    try {
      if (timestampMs - lastFaceT >= faceIntervalMs) {
        lastFaceT = timestampMs

        const { measurement, inferenceMs, skipped } = faceEngine.detect(video, timestampMs)
        if (!skipped) {
          const object = objectEngine.detect(video, timestampMs)
          const telemetry = ai.processFrame(measurement, timestampMs, {
            faceInferenceMs: inferenceMs,
            objectInferenceMs: object.inferenceMs,
            objectDetections: object.detections,
          }) as unknown as AiTelemetryFrame

          onTick({
            timestampMs,
            frame: toFrame(telemetry),
            telemetry,
          })
        }
      }
    } catch (err) {
      console.error('[hachiko] perception loop', err)
    }

    if (!stopped) video.requestVideoFrameCallback(onFrame)
  }

  video.requestVideoFrameCallback(onFrame)

  return {
    stop: () => {
      stopped = true
    },
  }
}

export interface OverlayLoopHandle {
  stop: () => void
}

/**
 * Simpler than startPerceptionLoop: one job (feed the live preview's
 * overlay), no interval throttling - the whole point is running on
 * every frame, since the model behind onBox is cheap enough to afford
 * that (see faceBox.ts). UI-only: BlazeFace never feeds the FocusEngine.
 */
export function startFaceBoxLoop(
  video: HTMLVideoElement,
  detector: FaceDetector,
  onBox: (box: FaceBox | null, timestampMs: number) => void,
): OverlayLoopHandle {
  let stopped = false
  let lastTimestampMs = -1

  const onFrame: VideoFrameRequestCallback = () => {
    if (stopped) return
    let timestampMs = Math.round(performance.now())
    // MediaPipe requires strictly increasing timestamps across calls to a
    // shared detector; unlike startPerceptionLoop's throttle, this loop
    // runs unthrottled on every video frame, so two frames landing in the
    // same rounded millisecond (a compositor stall, tab visibility change)
    // is rare but not impossible over a 15s window sampled 30-60x/sec.
    if (timestampMs <= lastTimestampMs) timestampMs = lastTimestampMs + 1
    lastTimestampMs = timestampMs
    try {
      onBox(readFaceBox(detector, video, timestampMs), timestampMs)
    } catch (err) {
      // Never let one bad frame kill the loop permanently - a frozen
      // preview is worse than a dropped frame.
      console.error('[hachiko] face box loop', err)
    }
    if (!stopped) video.requestVideoFrameCallback(onFrame)
  }

  video.requestVideoFrameCallback(onFrame)

  return {
    stop: () => {
      stopped = true
    },
  }
}
