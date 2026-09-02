/**
 * HACHIKO AI v0.1 — FaceLandmarkerEngine
 * ======================================
 * The ONLY module that touches MediaPipe, the camera, or the DOM. Everything
 * downstream consumes plain objects, which is what keeps the rest of the
 * pipeline unit-testable without a webcam.
 *
 * Wraps @mediapipe/tasks-vision FaceLandmarker in VIDEO running mode and emits
 * a raw Measurement per frame.
 */

import { HeadPoseExtractor } from './HeadPoseExtractor.js';
import { EyeFeatureExtractor } from './EyeFeatureExtractor.js';
import { PoseInvalidReason } from '../types.js';

export class FaceLandmarkerEngine {
  /**
   * @param {import('../config.js').CONFIG} config
   * @param {Object} deps  MediaPipe classes, injected so the core never imports
   *                       a bundler-specific path and stays testable.
   * @param {Function} deps.FilesetResolver from @mediapipe/tasks-vision
   * @param {Function} deps.FaceLandmarker  from @mediapipe/tasks-vision
   * @param {Object}  [deps.assetPaths]  overrides the config defaults; the host
   *        app decides where the model and WASM live (bundler URL, CDN, Tauri
   *        resource dir, packaged asset). Config only supplies a fallback.
   * @param {string}  [deps.assetPaths.modelAssetPath]
   * @param {string}  [deps.assetPaths.wasmPath]
   */
  constructor(config, deps) {
    this.config = config;
    this.deps = deps;
    this.landmarker = null;
    this.headPose = new HeadPoseExtractor(config);
    this.eyes = new EyeFeatureExtractor(config);
    this._lastVideoTimeMs = -1;
    this.activeDelegate = null;

    const overrides = deps?.assetPaths ?? {};
    this.assetPaths = {
      modelAssetPath: overrides.modelAssetPath ?? config.landmarker.modelAssetPath,
      wasmPath: overrides.wasmPath ?? config.landmarker.wasmPath,
    };
  }

  /**
   * Load WASM + model. Falls back GPU -> CPU, since student laptops vary and a
   * hard GPU requirement would exclude exactly the low-end devices v0.5 targets.
   */
  async initialize() {
    const { FilesetResolver, FaceLandmarker } = this.deps;
    const cfg = this.config.landmarker;
    const fileset = await FilesetResolver.forVisionTasks(this.assetPaths.wasmPath);

    const build = async (delegate) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: this.assetPaths.modelAssetPath, delegate },
        runningMode: 'VIDEO',
        numFaces: cfg.numFaces,
        minFaceDetectionConfidence: cfg.minFaceDetectionConfidence,
        minFacePresenceConfidence: cfg.minFacePresenceConfidence,
        minTrackingConfidence: cfg.minTrackingConfidence,
        outputFacialTransformationMatrixes: cfg.outputFacialTransformationMatrixes,
        outputFaceBlendshapes: cfg.outputFaceBlendshapes,
      });

    try {
      this.landmarker = await build(cfg.delegate);
      this.activeDelegate = cfg.delegate;
    } catch (err) {
      if (cfg.delegate === 'GPU') {
        console.warn('[HACHIKO] GPU delegate unavailable, falling back to CPU:', err);
        this.landmarker = await build('CPU');
        this.activeDelegate = 'CPU';
      } else {
        throw err;
      }
    }
    return this;
  }

  /**
   * Run detection on one video frame.
   *
   * IMPORTANT: `video` must NOT be mirrored. The debug preview is mirrored via
   * CSS only. The Python harness flipped the frame before inference, which
   * negated yaw and left its sign convention undefined.
   *
   * @param {HTMLVideoElement} video
   * @param {number} nowMs monotonic timestamp (performance.now())
   * @returns {{measurement:Object, inferenceMs:number, skipped:boolean}}
   */
  detect(video, nowMs) {
    if (!this.landmarker) throw new Error('FaceLandmarkerEngine not initialized');

    // MediaPipe VIDEO mode requires strictly increasing timestamps. Feeding the
    // same frame twice throws, so skip when the video clock has not advanced.
    if (video.currentTime === this._lastVideoTimeMs) {
      return { measurement: null, inferenceMs: 0, skipped: true };
    }
    this._lastVideoTimeMs = video.currentTime;

    const t0 = performance.now();
    let result;
    try {
      result = this.landmarker.detectForVideo(video, nowMs);
    } catch (err) {
      console.warn('[HACHIKO] detectForVideo failed:', err);
      return { measurement: this._emptyMeasurement(), inferenceMs: performance.now() - t0, skipped: false };
    }
    const inferenceMs = performance.now() - t0;

    const landmarks = result?.faceLandmarks?.[0] ?? null;
    if (!landmarks || landmarks.length === 0) {
      return { measurement: this._emptyMeasurement(), inferenceMs, skipped: false };
    }

    const matrix = result?.facialTransformationMatrixes?.[0] ?? null;
    const pose = this.headPose.extract(matrix);
    const ear = this.eyes.extract(
      landmarks, video.videoWidth || this.config.camera.width,
      video.videoHeight || this.config.camera.height
    );

    return {
      measurement: {
        facePresent: true,
        poseValid: pose.poseValid,
        poseInvalidReason: pose.poseInvalidReason,
        yawRaw: pose.yawRaw,
        pitchRaw: pose.pitchRaw,
        rollRaw: pose.rollRaw,
        gimbalLock: pose.gimbalLock,
        earLeft: ear.earLeft,
        earRight: ear.earRight,
        earMean: ear.earMean,
      },
      inferenceMs,
      skipped: false,
    };
  }

  /** No face this frame. Nulls, never zeros. */
  _emptyMeasurement() {
    return {
      facePresent: false,
      poseValid: false,
      poseInvalidReason: PoseInvalidReason.NO_FACE,
      yawRaw: null, pitchRaw: null, rollRaw: null, gimbalLock: false,
      earLeft: null, earRight: null, earMean: null,
    };
  }

  close() {
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
  }
}

export default FaceLandmarkerEngine;
