/**
 * HACHIKO AI v0.1 — EyeFeatureExtractor
 * =====================================
 * Computes per-eye and mean Eye Aspect Ratio from face landmarks.
 *
 * TWO FIXES over the Python harness (baseline_detection.py):
 *
 *  1. ASPECT-RATIO BUG. The harness scaled x by frame width and y by frame
 *     height independently, so EAR silently depended on the camera's aspect
 *     ratio and was not comparable across devices — fatal for a pilot spanning
 *     many student laptops. We scale BOTH axes by the SAME factor, so EAR is a
 *     true dimensionless ratio.
 *
 *  2. LOST PER-EYE SIGNAL. The harness computed ear_l and ear_r, averaged them
 *     immediately, and logged only the mean. Asymmetry (one eye occluded by a
 *     hand, or extreme yaw foreshortening one eye) was invisible. We keep and
 *     emit all three.
 *
 * NOTE ON UNITS: MediaPipe normalized landmarks are already in [0,1]. Uniform
 * scaling cancels in the ratio, so EAR is scale-invariant; we scale only to
 * keep the arithmetic away from denormals.
 */

import { eyeAspectRatio, isFiniteNumber } from '../core/math.js';

const UNIFORM_SCALE = 1000;

/**
 * Pull 6 landmarks and scale them uniformly.
 * @returns {{x:number,y:number}[]|null}
 */
function collectPoints(landmarks, indices, scaleX, scaleY) {
  const pts = [];
  for (const idx of indices) {
    const lm = landmarks[idx];
    if (!lm || !isFiniteNumber(lm.x) || !isFiniteNumber(lm.y)) return null;
    pts.push({ x: lm.x * scaleX, y: lm.y * scaleY });
  }
  return pts;
}

export class EyeFeatureExtractor {
  /** @param {import('../config.js').CONFIG} config */
  constructor(config) {
    this.config = config;
  }

  /**
   * @param {Array<{x:number,y:number}>} landmarks MediaPipe normalized landmarks
   * @param {number} frameWidth
   * @param {number} frameHeight
   * @returns {{earLeft:number|null, earRight:number|null, earMean:number|null}}
   */
  extract(landmarks, frameWidth, frameHeight) {
    const empty = { earLeft: null, earRight: null, earMean: null };
    if (!landmarks || landmarks.length === 0) return empty;

    let scaleX = UNIFORM_SCALE;
    let scaleY = UNIFORM_SCALE;
    if (!this.config.eye.aspectCorrect) {
      // Legacy (Python-equivalent) behaviour, kept only for A/B comparison
      // against the historical CSV. Not used by default.
      scaleX = frameWidth;
      scaleY = frameHeight;
    }

    const { leftEyeIndices, rightEyeIndices } = this.config.eye;
    const leftPts = collectPoints(landmarks, leftEyeIndices, scaleX, scaleY);
    const rightPts = collectPoints(landmarks, rightEyeIndices, scaleX, scaleY);

    const earLeft = leftPts ? eyeAspectRatio(leftPts) : null;
    const earRight = rightPts ? eyeAspectRatio(rightPts) : null;

    // Mean only when BOTH eyes are measurable. Falling back to a single eye
    // would make earMean jump discontinuously the moment one eye is occluded,
    // which the state engine would read as a sudden closure.
    const earMean =
      isFiniteNumber(earLeft) && isFiniteNumber(earRight)
        ? (earLeft + earRight) / 2
        : null;

    return { earLeft, earRight, earMean };
  }
}

export default EyeFeatureExtractor;
