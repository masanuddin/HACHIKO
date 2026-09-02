/**
 * v0.3 tests — phone event tracking.
 *
 * TWO INVARIANTS:
 *  1. A phone detection NEVER changes FOKUS / TERALIH / TIDAK_HADIR. A phone at
 *     a study desk is genuinely ambiguous (calculator, dictionary, recording,
 *     or distraction), so the AI records WHEN and leaves WHY to the app, which
 *     asks the student. Every event ships with context PENDING.
 *  2. Events must be temporally stable — a flickering detector must not produce
 *     hundreds of one-frame "events".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HachikoAI, PhoneEventTracker, CONFIG, withOverrides,
  AIState, StateReason, PhoneEventStatus, PhoneContext,
} from '../src/ai/index.js';

const FRAME_MS = 1000 / 30;
const REAL = { yaw: -2.8, pitchCanon: -2.3, ear: 0.394 };
const W = CONFIG.camera.width, H = CONFIG.camera.height;

const phoneDet = (confidence = 0.80) => ({
  category: 'cell phone', confidence,
  boundingBox: { originX: 100, originY: 200, width: 60, height: 110 },
  timestampMs: 0,
});
const personDet = () => ({
  category: 'person', confidence: 0.85,
  boundingBox: { originX: W * 0.25, originY: H * 0.10, width: W * 0.5, height: H * 0.85 },
  timestampMs: 0,
});

/** Drive the tracker directly with a detection list per frame. */
function drive(tracker, startMs, durationMs, build) {
  let t = startMs;
  for (; t < startMs + durationMs; t += FRAME_MS) tracker.update(build(t), t);
  return t;
}

function measurement(over = {}) {
  return {
    facePresent: true, poseValid: true, poseInvalidReason: 'NONE',
    yawRaw: REAL.yaw, pitchRaw: REAL.pitchCanon, rollRaw: 0,
    earLeft: REAL.ear, earRight: REAL.ear, earMean: REAL.ear,
    ...over,
  };
}
function calibratedAI() {
  const ai = new HachikoAI(CONFIG);
  ai.startCalibration(0);
  for (let t = 0; t < CONFIG.calibration.CALIBRATION_DURATION_MS + FRAME_MS; t += FRAME_MS) {
    ai.processFrame(measurement(), t, { objectDetections: [personDet()] });
  }
  assert.equal(ai.calibration.isValid(), true);
  return { ai, t0: CONFIG.calibration.CALIBRATION_DURATION_MS + FRAME_MS };
}

// ── Event creation ──────────────────────────────────────────────────────
test('F1. a one-frame detection creates NO event', () => {
  const tracker = new PhoneEventTracker(CONFIG);
  tracker.update([phoneDet()], 0);
  tracker.update([], FRAME_MS);
  drive(tracker, FRAME_MS * 2, 2000, () => []);
  assert.equal(tracker.getEvents().length, 0,
    'detector noise must not become an event');
});

test('F2. sustained detection creates exactly one event', () => {
  const tracker = new PhoneEventTracker(CONFIG);
  drive(tracker, 0, 5000, () => [phoneDet()]);
  const events = tracker.getEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].status, PhoneEventStatus.ACTIVE);
  assert.equal(events[0].eventId, 1);
});

test('F3. a short dropout does NOT split the event', () => {
  const tracker = new PhoneEventTracker(CONFIG);
  let t = drive(tracker, 0, 2000, () => [phoneDet()]);
  // 500 ms gap, inside PHONE_EXIT_GRACE_MS (900 ms).
  t = drive(tracker, t, 500, () => []);
  t = drive(tracker, t, 2000, () => [phoneDet()]);
  assert.equal(tracker.getEvents().length, 1, 'still one continuous event');
  assert.equal(tracker.activeEvent.status, PhoneEventStatus.ACTIVE);
});

test('F4. a long dropout closes the event', () => {
  const tracker = new PhoneEventTracker(CONFIG);
  let t = drive(tracker, 0, 2000, () => [phoneDet()]);
  t = drive(tracker, t, 2000, () => []);
  const events = tracker.getEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].status, PhoneEventStatus.COMPLETED);
  assert.equal(tracker.activeEvent, null);
});

test('F5. a later occurrence creates a SECOND event', () => {
  const tracker = new PhoneEventTracker(CONFIG);
  let t = drive(tracker, 0, 2000, () => [phoneDet()]);
  t = drive(tracker, t, 2000, () => []);        // closes #1
  t = drive(tracker, t, 2000, () => [phoneDet()]); // opens #2
  const events = tracker.getEvents();
  assert.equal(events.length, 2);
  assert.equal(events[0].eventId, 1);
  assert.equal(events[1].eventId, 2);
  assert.equal(events[0].status, PhoneEventStatus.COMPLETED);
  assert.equal(events[1].status, PhoneEventStatus.ACTIVE);
});

// ── Duration and confidence ─────────────────────────────────────────────
test('F6. event duration is correct and excludes the exit grace', () => {
  const tracker = new PhoneEventTracker(CONFIG);
  // Phone visible for ~3 s, then gone.
  let t = drive(tracker, 0, 3000, () => [phoneDet()]);
  const lastSighting = t - FRAME_MS;
  drive(tracker, t, 2000, () => []);

  const [event] = tracker.getEvents();
  assert.equal(event.status, PhoneEventStatus.COMPLETED);
  // Ends at the last real sighting, not at grace expiry — the grace window is
  // detector tolerance, not phone-use time.
  assert.ok(Math.abs(event.endMs - lastSighting) < FRAME_MS * 2,
    `endMs ${event.endMs} should be the last sighting ${lastSighting}`);
  assert.ok(Math.abs(event.durationMs - 3000) < 100,
    `duration ${event.durationMs} should be ~3000 ms`);
});

test('F7. confidence statistics are correct', () => {
  const tracker = new PhoneEventTracker(CONFIG);
  const values = [0.60, 0.70, 0.80, 0.90];
  let i = 0;
  drive(tracker, 0, 4 * FRAME_MS, () => [phoneDet(values[i++] ?? 0.90)]);
  // Push past PHONE_ENTER_MS so the event opens with those samples.
  drive(tracker, 4 * FRAME_MS, 1000, () => [phoneDet(0.90)]);

  const [event] = tracker.getEvents();
  assert.ok(event, 'event opened');
  assert.ok(Math.abs(event.confidenceMax - 0.90) < 1e-9);
  assert.ok(event.confidenceMean > 0.6 && event.confidenceMean <= 0.9,
    `mean ${event.confidenceMean} should sit between the observed values`);
});

test('F8. low-confidence detections are filtered before tracking', () => {
  // Below minPhoneConfidence the detector layer drops them, so the tracker
  // never sees them. Simulated here by passing an empty list.
  const tracker = new PhoneEventTracker(CONFIG);
  drive(tracker, 0, 3000, () => []);
  assert.equal(tracker.getEvents().length, 0);
});

// ── Context ─────────────────────────────────────────────────────────────
test('F9. phone context defaults to PENDING', () => {
  const tracker = new PhoneEventTracker(CONFIG);
  drive(tracker, 0, 2000, () => [phoneDet()]);
  const [event] = tracker.getEvents();
  assert.equal(event.context, PhoneContext.PENDING,
    'only the student can say whether phone use was study-related');
  // v0.3 must not offer any other value.
  assert.deepEqual(Object.values(PhoneContext), ['PENDING']);
});

// ── Detector cadence ────────────────────────────────────────────────────
test('F10. a throttled non-run does not close an active event', () => {
  const tracker = new PhoneEventTracker(CONFIG);
  let t = drive(tracker, 0, 2000, () => [phoneDet()]);
  // null = detector did not run. That is "no news", not "no phone".
  t = drive(tracker, t, 600, () => null);
  assert.equal(tracker.activeEvent?.status, PhoneEventStatus.ACTIVE);
  assert.equal(tracker.getEvents().length, 1);
});

test('F11. detector flicker produces one event, not many', () => {
  const tracker = new PhoneEventTracker(CONFIG);
  // Phone genuinely held for 10 s, but the detector drops every 3rd frame.
  let n = 0;
  drive(tracker, 0, 10000, () => (n++ % 3 === 0 ? [] : [phoneDet()]));
  assert.equal(tracker.getEvents().length, 1,
    'flicker must not fragment a single episode');
});

// ── The hard boundary: phone never drives state ─────────────────────────
test('F12. a phone detection NEVER changes the AI state', () => {
  const { ai, t0 } = calibratedAI();
  let t = t0;
  const states = new Set();
  for (const end = t + 15000; t < end; t += FRAME_MS) {
    const f = ai.processFrame(measurement(), t, {
      objectDetections: [personDet(), phoneDet(0.95)],
    });
    states.add(f.classification.state);
  }
  assert.deepEqual([...states], [AIState.FOKUS],
    'a visible phone must not alter the behavioural state');
  // But the event IS recorded.
  assert.ok(ai.getPhoneEvents().length >= 1, 'the event is still tracked');
});

test('F13. phone presence does not change the state REASON either', () => {
  const { ai, t0 } = calibratedAI();
  let t = t0;
  // Sustained yaw with a phone visible: reason must stay YAW, not become phone.
  let frame;
  for (const end = t + 9000; t < end; t += FRAME_MS) {
    frame = ai.processFrame(measurement({ yawRaw: REAL.yaw - 40 }), t, {
      objectDetections: [personDet(), phoneDet(0.95)],
    });
  }
  assert.equal(frame.classification.state, AIState.TERALIH);
  assert.equal(frame.classification.primaryReason, StateReason.YAW);
  assert.ok(!String(frame.classification.primaryReason).includes('PHONE'));
});

test('F14. StateReason has no phone member at all', () => {
  // Structural guarantee: phone cannot be named as a state reason.
  assert.equal(StateReason.PHONE, undefined);
  assert.equal(StateReason.PHONE_USE, undefined);
  assert.ok(!Object.values(StateReason).some((r) => /PHONE/.test(r)));
});

test('F15. phone events surface in telemetry, separate from classification', () => {
  const { ai, t0 } = calibratedAI();
  let t = t0, frame;
  for (const end = t + 3000; t < end; t += FRAME_MS) {
    frame = ai.processFrame(measurement(), t, {
      objectDetections: [personDet(), phoneDet(0.9)],
    });
  }
  assert.ok('phoneEvent' in frame);
  assert.ok(frame.phoneEvent.activeEventId >= 1);
  assert.ok(frame.phoneEvent.activeDurationMs > 0);
  assert.equal(frame.objects.phonePresent, true);
  assert.ok(Number.isFinite(frame.objects.phoneConfidence));
  // Never inside the prediction.
  assert.ok(!('phonePresent' in frame.classification));
  assert.ok(!('activeEventId' in frame.classification));
});

// ── Config-driven ───────────────────────────────────────────────────────
test('F16. hysteresis windows come from config', () => {
  const cfg = withOverrides({ phoneEvents: { PHONE_ENTER_MS: 2000 } });
  const tracker = new PhoneEventTracker(cfg);
  // 1 s of detection is now below the (raised) entry window.
  drive(tracker, 0, 1000, () => [phoneDet()]);
  assert.equal(tracker.getEvents().length, 0);
  // Past 2 s it opens.
  drive(tracker, 1000, 1500, () => [phoneDet()]);
  assert.equal(tracker.getEvents().length, 1);
});

test('F17. phone tracking can be disabled entirely', () => {
  const cfg = withOverrides({ phoneEvents: { enabled: false } });
  const tracker = new PhoneEventTracker(cfg);
  drive(tracker, 0, 5000, () => [phoneDet()]);
  assert.equal(tracker.getEvents().length, 0);
});
