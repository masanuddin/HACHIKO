/**
 * HACHIKO AI v0.3 — PresenceFusion
 * ================================
 * Decides whether the USER IS THERE, from face presence + primary-person
 * detection + temporal persistence.
 *
 * ── THE BUG THIS EXISTS TO FIX ───────────────────────────────────────────
 * Face AI v0.2 treated "face not detected" as "person absent". Real webcam
 * testing confirmed the failure: turn far enough and the face detector drops
 * out (Face = NO, Pose = INVALID) while the user's body is plainly visible —
 * and v0.2 eventually reported TIDAK_HADIR for a user sitting right there.
 *
 * Presence is now its own authority with its own timer, separate from the
 * head-pose evidence timers. Face AI itself is untouched.
 *
 * ── RULES ────────────────────────────────────────────────────────────────
 *   A. face YES                   -> PRESENT               (person irrelevant)
 *   B. face NO,  person YES       -> PRESENT_FACE_UNAVAILABLE  (never absence)
 *   C. face NO,  person NO        -> accumulate; only sustained loss -> ABSENT
 *   D. person detector misses but face YES -> still PRESENT
 *
 * Face presence alone is sufficient proof of presence: if we can see a face,
 * the user is there, whatever the object detector thinks.
 *
 * ── PRIMARY-USER ASSOCIATION ─────────────────────────────────────────────
 * Deliberately simple and deterministic — no re-identification model, no
 * multi-object tracker (both explicitly out of scope):
 *
 *   1. Face available -> the person box CONTAINING the face centre is the
 *      primary user. That anchors identity to the actual face.
 *   2. Face lost      -> follow the remembered box by IoU, falling back to
 *      centre distance when boxes barely overlap between sparse inference
 *      ticks, for a bounded hold window.
 *   3. No prior box and no face -> adopt a lone person only when there is
 *      EXACTLY ONE candidate, so a background person never silently becomes
 *      "the user".
 */

import { PresenceStatus } from '../types.js';
import { isFiniteNumber } from '../core/math.js';

/** Intersection-over-union of two pixel boxes. */
export function iou(a, b) {
  if (!a || !b) return 0;
  const ax2 = a.originX + a.width;
  const ay2 = a.originY + a.height;
  const bx2 = b.originX + b.width;
  const by2 = b.originY + b.height;

  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.originX, b.originX));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.originY, b.originY));
  const inter = ix * iy;
  if (inter <= 0) return 0;

  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/** Centre point of a pixel box. */
export function boxCenter(box) {
  return box
    ? { x: box.originX + box.width / 2, y: box.originY + box.height / 2 }
    : null;
}

/** Does a box contain a point? */
export function boxContains(box, point) {
  if (!box || !point) return false;
  return point.x >= box.originX && point.x <= box.originX + box.width
      && point.y >= box.originY && point.y <= box.originY + box.height;
}

export class PresenceFusion {
  /** @param {import('../config.js').CONFIG} config */
  constructor(config) {
    this.config = config;
    this.reset();
  }

  reset() {
    this.status = PresenceStatus.PRESENT;
    /** Remembered primary-user box, in pixels. */
    this.primaryPersonBox = null;
    this.primaryPersonConfidence = null;
    /** When the primary box was last confirmed by a real detection. */
    this.primaryPersonLastSeenMs = null;
    this.primaryPersonTracked = false;
    /**
     * True once a primary user has ever been identified this session. After
     * that, an unassociated person is a DIFFERENT person, never a replacement.
     */
    this._hadPrimary = false;
    this.bothMissingMs = 0;
    this.recoveredMs = 0;
    this._lastMs = null;
    this._absent = false;
  }

  /**
   * @param {Object} input
   * @param {boolean} input.faceAvailable            face detected this frame
   * @param {{x:number,y:number}|null} input.faceCenter  pixels, when known
   * @param {Array|null} input.personDetections      null = detector did not run
   * @param {number} nowMs
   */
  update(input, nowMs) {
    const cfg = this.config.presence;

    let dt = 0;
    if (isFiniteNumber(this._lastMs)) {
      dt = nowMs - this._lastMs;
      // Ignore absurd gaps (tab throttled / machine slept) so a suspended tab
      // is never credited as seconds of absence.
      if (dt < 0 || dt > this.config.temporal.maxFrameDeltaMs) dt = 0;
    }
    this._lastMs = nowMs;

    // ── 1. Primary-user association ────────────────────────────────────
    const assoc = this._associatePrimaryPerson(input, nowMs);
    const primaryPersonPresent = assoc.present;

    // ── 2. Presence decision ───────────────────────────────────────────
    // Face wins outright: seeing a face proves presence (Rules A and D).
    if (input.faceAvailable) {
      // A visible FACE is conclusive: clear absence immediately, no window.
      // Face detection is far stronger evidence of the specific user than a
      // person box, so it needs no corroboration over time.
      this.bothMissingMs = 0;
      this.recoveredMs += dt;
      this._absent = false;
      this.status = PresenceStatus.PRESENT;
    } else if (primaryPersonPresent) {
      // Rule B — THE v0.3 FIX. Face lost but the user is visibly there.
      // This must never accumulate toward absence.
      //
      // Note we do NOT clear `_absent` here. Person-only evidence is weaker,
      // so recovery FROM a concluded absence must be sustained for
      // PRIMARY_PERSON_RECOVER_MS (handled by the recovery gate below). Until
      // then the public state stays TIDAK_HADIR, which is why one lucky
      // detection frame cannot cancel a real absence.
      this.bothMissingMs = 0;
      this.recoveredMs += dt;
      if (!this._absent) this.status = PresenceStatus.PRESENT_FACE_UNAVAILABLE;
    } else {
      // Rule C — neither signal. Accumulate; conclude only when sustained.
      this.bothMissingMs += dt;
      this.recoveredMs = 0;
      if (this.bothMissingMs >= cfg.BOTH_MISSING_ENTER_MS) {
        this._absent = true;
        this.status = PresenceStatus.ABSENT;
      } else {
        this.status = this._absent
          ? PresenceStatus.ABSENT
          : PresenceStatus.MISSING_PENDING;
      }
    }

    // Clearing absence needs SUSTAINED recovery, so one lucky detection frame
    // cannot cancel a real absence.
    if (this._absent && this.recoveredMs >= cfg.PRIMARY_PERSON_RECOVER_MS) {
      this._absent = false;
      this.bothMissingMs = 0;
      this.status = input.faceAvailable
        ? PresenceStatus.PRESENT
        : PresenceStatus.PRESENT_FACE_UNAVAILABLE;
    }
    if (this._absent) this.status = PresenceStatus.ABSENT;

    return {
      status: this.status,
      absent: this._absent,
      bothMissingMs: this.bothMissingMs,
      primaryPersonPresent,
      primaryPersonConfidence: this.primaryPersonConfidence,
      primaryPersonTracked: this.primaryPersonTracked,
      primaryPersonBox: this.primaryPersonBox,
      associationMethod: assoc.method,
    };
  }

  /**
   * Identify which detected person (if any) is the primary user.
   * @returns {{present:boolean, method:string}}
   */
  _associatePrimaryPerson(input, nowMs) {
    const cfg = this.config.presence;
    const personLabel = this.config.objectDetector.labels.PERSON;
    const detections = input.personDetections;

    // null means the throttled detector did not run this frame. Hold the
    // previous association rather than treating silence as disappearance.
    if (detections === null || detections === undefined) {
      return this._holdPrevious(nowMs, 'DETECTOR_NOT_RUN');
    }

    const persons = detections.filter(
      (d) => d.category === personLabel && d.boundingBox
    );
    if (persons.length === 0) {
      return this._holdPrevious(nowMs, 'NO_PERSON_DETECTED');
    }

    // ── Strategy 1: anchor to the face ────────────────────────────────
    // The box containing the face centre is unambiguously the user.
    if (input.faceAvailable && input.faceCenter) {
      const containing = persons.filter((p) => boxContains(p.boundingBox, input.faceCenter));
      if (containing.length > 0) {
        // Smallest containing box = the individual, not a group-spanning box.
        const best = containing.reduce((a, b) =>
          (a.boundingBox.width * a.boundingBox.height)
            <= (b.boundingBox.width * b.boundingBox.height) ? a : b);
        this._setPrimary(best, nowMs);
        return { present: true, method: 'FACE_CONTAINED' };
      }
      // Face visible but inside no person box (partial body, tight crop).
      // Fall through: face alone already proves presence.
    }

    // ── Strategy 2: spatial continuity with the remembered box ────────
    if (this.primaryPersonBox) {
      let bestMatch = null;
      let bestScore = -1;
      for (const p of persons) {
        const overlap = iou(this.primaryPersonBox, p.boundingBox);
        if (overlap > bestScore) { bestScore = overlap; bestMatch = p; }
      }
      if (bestMatch && bestScore >= cfg.PRIMARY_PERSON_MIN_IOU) {
        this._setPrimary(bestMatch, nowMs);
        return { present: true, method: 'IOU' };
      }

      // IoU can collapse to 0 when the user moves between sparse inference
      // ticks, so fall back to centre proximity before giving up.
      const prevCenter = boxCenter(this.primaryPersonBox);
      const frameWidth = input.frameWidth ?? this.config.camera.width;
      const maxDist = frameWidth * cfg.PRIMARY_PERSON_MAX_CENTER_DIST_RATIO;
      let nearest = null;
      let nearestDist = Infinity;
      for (const p of persons) {
        const c = boxCenter(p.boundingBox);
        const dist = Math.hypot(c.x - prevCenter.x, c.y - prevCenter.y);
        if (dist < nearestDist) { nearestDist = dist; nearest = p; }
      }
      if (nearest && nearestDist <= maxDist) {
        this._setPrimary(nearest, nowMs);
        return { present: true, method: 'CENTER_DISTANCE' };
      }

      // A person is visible but is not our user (e.g. someone walking behind).
      return this._holdPrevious(nowMs, 'NO_ASSOCIATION');
    }

    // ── Strategy 3: adopt a lone person ───────────────────────────────
    // Only when there is exactly one candidate, so a background person can
    // never silently be promoted to "the user".
    //
    // Guarded by `_hadPrimary`: once we have known who the user is, a person
    // who FAILED association is a different person, and must not be adopted
    // just because the tracking hold has since expired and left no box to
    // compare against. Without this, a passer-by becomes "the user" ~1 s after
    // the real user leaves — masking a genuine absence.
    //
    // The guard lifts once we have concluded ABSENCE — but only for a person
    // in a PLAUSIBLE seat position. After a genuine absence a single person
    // appearing where the user sits is the user returning, whereas someone
    // lingering at the edge of frame is not, and adopting them would mask a
    // real absence. Without some re-adoption path, absence could never clear
    // via person-only detection and a returning user would be stranded in
    // TIDAK_HADIR; without the position check, any passer-by would clear it.
    const mayAdopt = !this._hadPrimary
      || (this._absent && this._isPlausibleUserPosition(persons[0], input));
    if (cfg.adoptSinglePersonWhenUnassociated
        && persons.length === 1
        && mayAdopt) {
      this._setPrimary(persons[0], nowMs);
      return { present: true, method: 'SINGLE_PERSON_ADOPTED' };
    }

    return {
      present: false,
      method: persons.length > 1 ? 'AMBIGUOUS_MULTIPLE_PERSONS' : 'NO_ASSOCIATION',
    };
  }

  /**
   * Keep the previous association alive for a bounded window. This is what
   * makes the system tolerate the object detector's sparse cadence and its
   * occasional dropped detections.
   */
  _holdPrevious(nowMs, method) {
    const cfg = this.config.presence;
    if (this.primaryPersonBox && isFiniteNumber(this.primaryPersonLastSeenMs)) {
      const age = nowMs - this.primaryPersonLastSeenMs;
      if (age <= cfg.PRIMARY_PERSON_TRACK_HOLD_MS) {
        this.primaryPersonTracked = true;
        return { present: true, method: `${method}_HELD` };
      }
    }
    // Hold expired: forget the box so a stale position cannot mislead later.
    this.primaryPersonTracked = false;
    this.primaryPersonBox = null;
    this.primaryPersonConfidence = null;
    return { present: false, method };
  }

  /**
   * Is this person plausibly the seated user rather than a passer-by?
   *
   * A webcam user sits centred and fills much of the frame. Someone at the
   * edge, or occupying a small slice of it, is background. Deliberately crude —
   * this is a sanity check on re-adoption after absence, not tracking.
   */
  _isPlausibleUserPosition(person, input) {
    const box = person?.boundingBox;
    if (!box) return false;
    const frameWidth = input.frameWidth ?? this.config.camera.width;
    const centerX = box.originX + box.width / 2;
    // Centre of mass within the middle half of the frame.
    const horizontallyCentred =
      centerX > frameWidth * 0.25 && centerX < frameWidth * 0.75;
    // And occupying a meaningful share of the frame width (i.e. close enough).
    const largeEnough = box.width >= frameWidth * 0.25;
    return horizontallyCentred && largeEnough;
  }

  _setPrimary(detection, nowMs) {
    this._hadPrimary = true;
    this.primaryPersonBox = detection.boundingBox;
    this.primaryPersonConfidence = detection.confidence;
    this.primaryPersonLastSeenMs = nowMs;
    this.primaryPersonTracked = false;   // freshly confirmed, not extrapolated
  }
}

export default PresenceFusion;
