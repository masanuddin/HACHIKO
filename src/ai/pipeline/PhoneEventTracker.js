/**
 * HACHIKO AI v0.3 — PhoneEventTracker
 * ===================================
 * Aggregates raw `cell phone` detections into stable, discrete events.
 *
 * ── HARD BOUNDARY ────────────────────────────────────────────────────────
 * A phone detection NEVER changes FOKUS / TERALIH / TIDAK_HADIR. This module
 * has no path into the state engine — it only produces an event stream.
 *
 * That is a product decision, not a technical shortcut: a phone at a study desk
 * is genuinely ambiguous. It may be a calculator, a dictionary, a lecture
 * recording, or a distraction. The AI cannot tell, so it records WHEN a phone
 * was visible and leaves interpretation to the app (v0.4+), which asks the
 * student during a break. Every event therefore ships with context PENDING.
 *
 * ── TEMPORAL STABILITY ───────────────────────────────────────────────────
 * A raw detector flickers, and naive per-frame logging would produce hundreds
 * of meaningless one-frame "events". Two-sided hysteresis prevents that:
 *
 *   detected 1 frame          -> nothing (below PHONE_ENTER_MS)
 *   detected continuously     -> event opens
 *   detection briefly missing -> SAME event stays open (within exit grace)
 *   missing beyond grace      -> event closes, ending at the LAST sighting
 *
 * Closing at the last real sighting (not at grace expiry) keeps durations
 * honest — the grace window is detector tolerance, not phone-use time.
 */

import { PhoneEventStatus, PhoneContext } from '../types.js';
import { isFiniteNumber } from '../core/math.js';

export class PhoneEventTracker {
  /** @param {import('../config.js').CONFIG} config */
  constructor(config) {
    this.config = config;
    this.reset();
  }

  reset() {
    /** @type {import('../types.js').PhoneEvent[]} */
    this.events = [];
    this.activeEvent = null;
    this._nextEventId = 1;
    /** Candidate accumulation before an event is allowed to open. */
    this._candidateSinceMs = null;
    this._lastDetectedMs = null;
    /** Confidences for the run currently being accumulated. */
    this._runConfidences = [];
  }

  /**
   * @param {Array|null} detections null = detector did not run this frame
   * @param {number} nowMs
   * @returns {{phonePresent:boolean, phoneConfidence:number|null,
   *            activeEventId:number|null, activeDurationMs:number}}
   */
  update(detections, nowMs) {
    const cfg = this.config.phoneEvents;
    const phoneLabel = this.config.objectDetector.labels.PHONE;

    // A throttled non-run is NOT evidence of absence. Treat it as "no news":
    // the exit grace keeps an active event alive across the gap.
    const detectorRan = detections !== null && detections !== undefined;

    let phone = null;
    if (detectorRan) {
      for (const d of detections) {
        if (d.category !== phoneLabel) continue;
        if (!phone || d.confidence > phone.confidence) phone = d;
      }
    }

    if (!cfg.enabled) {
      return { phonePresent: false, phoneConfidence: null, activeEventId: null, activeDurationMs: 0 };
    }

    if (phone) {
      this._onDetected(phone, nowMs);
    } else if (detectorRan) {
      this._onNotDetected(nowMs);
    } else {
      // Detector idle between ticks: only check whether grace has expired.
      this._checkExitGrace(nowMs);
    }

    return {
      phonePresent: !!phone,
      phoneConfidence: phone ? phone.confidence : null,
      activeEventId: this.activeEvent ? this.activeEvent.eventId : null,
      activeDurationMs: this.activeEvent
        ? Math.max(0, nowMs - this.activeEvent.startMs)
        : 0,
    };
  }

  _onDetected(phone, nowMs) {
    const cfg = this.config.phoneEvents;
    this._lastDetectedMs = nowMs;
    this._runConfidences.push(phone.confidence);

    if (this.activeEvent) {
      // Already open — extend it and fold in the new confidence.
      this.activeEvent.endMs = nowMs;
      this.activeEvent.durationMs = nowMs - this.activeEvent.startMs;
      this.activeEvent.confidenceMax = Math.max(this.activeEvent.confidenceMax, phone.confidence);
      this.activeEvent._confSum += phone.confidence;
      this.activeEvent._confCount += 1;
      this.activeEvent.confidenceMean =
        this.activeEvent._confSum / this.activeEvent._confCount;
      return;
    }

    // Not yet open: accumulate toward PHONE_ENTER_MS.
    if (this._candidateSinceMs === null) {
      this._candidateSinceMs = nowMs;
      this._runConfidences = [phone.confidence];
      return;
    }
    if ((nowMs - this._candidateSinceMs) >= cfg.PHONE_ENTER_MS) {
      this._openEvent(nowMs);
    }
  }

  _onNotDetected(nowMs) {
    if (!this.activeEvent) {
      // A candidate run is forming. Tolerate brief gaps here exactly as the
      // exit grace does, otherwise a detector that flickers faster than
      // PHONE_ENTER_MS can never accumulate enough continuous time and a phone
      // held for minutes produces NO event at all. (Real EfficientDet output
      // flickers readily on a small, partly-occluded object.)
      //
      // Gaps longer than the grace still discard the run, which is what stops
      // isolated single-frame detections from becoming events.
      if (this._candidateSinceMs === null) return;
      const gap = nowMs - (this._lastDetectedMs ?? this._candidateSinceMs);
      if (gap > this.config.phoneEvents.PHONE_EXIT_GRACE_MS) {
        this._candidateSinceMs = null;
        this._lastDetectedMs = null;
        this._runConfidences = [];
      }
      return;
    }
    this._checkExitGrace(nowMs);
  }

  _checkExitGrace(nowMs) {
    if (!this.activeEvent || !isFiniteNumber(this._lastDetectedMs)) return;
    const gap = nowMs - this._lastDetectedMs;
    if (gap > this.config.phoneEvents.PHONE_EXIT_GRACE_MS) {
      this._closeEvent();
    }
  }

  _openEvent(nowMs) {
    const confidences = this._runConfidences;
    const sum = confidences.reduce((a, b) => a + b, 0);
    const event = {
      eventId: this._nextEventId++,
      // Backdate to the first sighting: phone use began then, not once our
      // debounce was satisfied.
      startMs: this._candidateSinceMs,
      endMs: nowMs,
      durationMs: nowMs - this._candidateSinceMs,
      confidenceMean: confidences.length ? sum / confidences.length : 0,
      confidenceMax: confidences.length ? Math.max(...confidences) : 0,
      status: PhoneEventStatus.ACTIVE,
      // Always PENDING: only the student can say whether it was for study.
      context: PhoneContext.PENDING,
      _confSum: sum,
      _confCount: confidences.length,
    };
    this.activeEvent = event;
    this.events.push(event);
    if (this.events.length > this.config.phoneEvents.maxEvents) this.events.shift();
  }

  _closeEvent() {
    if (!this.activeEvent) return;
    // End at the LAST real sighting, not at grace expiry, so the grace window
    // never inflates reported phone-use duration.
    this.activeEvent.endMs = this._lastDetectedMs;
    this.activeEvent.durationMs = Math.max(0, this._lastDetectedMs - this.activeEvent.startMs);
    this.activeEvent.status = PhoneEventStatus.COMPLETED;
    this.activeEvent = null;
    this._candidateSinceMs = null;
    this._lastDetectedMs = null;
    this._runConfidences = [];
  }

  /** Serializable events, with internal accumulators stripped. */
  getEvents() {
    return this.events.map(({ _confSum, _confCount, ...e }) => ({ ...e }));
  }

  getCompletedEvents() {
    return this.getEvents().filter((e) => e.status === PhoneEventStatus.COMPLETED);
  }
}

export default PhoneEventTracker;
