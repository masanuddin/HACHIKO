/**
 * v0.3 tests — presence fusion (face + primary person).
 *
 * THE BUG THIS RELEASE FIXES, confirmed on real hardware:
 * a user who turns far enough loses the face detector (Face = NO,
 * Pose = INVALID) while their body is plainly visible, and Face AI v0.2
 * eventually reported TIDAK_HADIR for someone sitting right there.
 *
 * "face not detected" != "person absent".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HachikoAI, PresenceFusion, CONFIG, withOverrides,
  AIState, StateReason, PresenceStatus, iou, boxContains,
} from '../src/ai/index.js';

const FRAME_MS = 1000 / 30;
const REAL = { yaw: -2.8, pitchCanon: -2.3, ear: 0.394 };
const W = CONFIG.camera.width, H = CONFIG.camera.height;

function measurement(over = {}) {
  return {
    facePresent: true, poseValid: true, poseInvalidReason: 'NONE',
    yawRaw: REAL.yaw, pitchRaw: REAL.pitchCanon, rollRaw: 0,
    earLeft: REAL.ear, earRight: REAL.ear, earMean: REAL.ear,
    ...over,
  };
}
/** Face genuinely lost (turned away / occluded), as the live failure produced. */
const faceLost = (over = {}) => measurement({
  facePresent: false, poseValid: false, poseInvalidReason: 'NO_FACE',
  yawRaw: null, pitchRaw: null, rollRaw: null,
  earLeft: null, earRight: null, earMean: null,
  ...over,
});

/** A person detection covering the middle of the frame (where a seated user is). */
function personDet(over = {}) {
  return {
    category: 'person', confidence: 0.85,
    boundingBox: { originX: W * 0.25, originY: H * 0.10, width: W * 0.5, height: H * 0.85 },
    timestampMs: 0, ...over,
  };
}
/** A person off to the side — a passer-by, not the user. */
function backgroundPersonDet() {
  return {
    category: 'person', confidence: 0.80,
    boundingBox: { originX: W * 0.80, originY: H * 0.30, width: W * 0.18, height: H * 0.5 },
    timestampMs: 0,
  };
}

function run(ai, startMs, durationMs, build) {
  const frames = [];
  for (let t = startMs; t < startMs + durationMs; t += FRAME_MS) {
    const spec = build(t);
    frames.push(ai.processFrame(spec.measurement, t, {
      objectDetections: spec.objects,
      faceInferenceMs: 10, objectInferenceMs: 20,
    }));
  }
  return frames;
}
function calibratedAI(config = CONFIG) {
  const ai = new HachikoAI(config);
  ai.startCalibration(0);
  run(ai, 0, config.calibration.CALIBRATION_DURATION_MS + FRAME_MS,
    () => ({ measurement: measurement(), objects: [personDet()] }));
  assert.equal(ai.calibration.isValid(), true);
  return { ai, t0: config.calibration.CALIBRATION_DURATION_MS + FRAME_MS };
}
const last = (f) => f[f.length - 1];

// ── Geometry helpers ────────────────────────────────────────────────────
test('iou and boxContains behave correctly', () => {
  const a = { originX: 0, originY: 0, width: 100, height: 100 };
  assert.equal(iou(a, a), 1);
  assert.equal(iou(a, { originX: 200, originY: 200, width: 50, height: 50 }), 0);
  const half = { originX: 50, originY: 0, width: 100, height: 100 };
  assert.ok(Math.abs(iou(a, half) - (5000 / 15000)) < 1e-9);
  assert.equal(boxContains(a, { x: 50, y: 50 }), true);
  assert.equal(boxContains(a, { x: 150, y: 50 }), false);
});

// ── The four presence cases ─────────────────────────────────────────────
test('P1. face=yes, person=yes -> PRESENT', () => {
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 3000, () => ({ measurement: measurement(), objects: [personDet()] })));
  assert.equal(f.presence.status, PresenceStatus.PRESENT);
  assert.equal(f.classification.state, AIState.FOKUS);
  assert.equal(f.validity.stateSignalValid, true);
});

test('P2. face=yes, person=no -> PRESENT (face alone is sufficient)', () => {
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 6000, () => ({ measurement: measurement(), objects: [] })));
  assert.equal(f.presence.status, PresenceStatus.PRESENT);
  assert.notEqual(f.classification.state, AIState.TIDAK_HADIR);
});

test('P3. face=no, person=yes -> PRESENT_FACE_UNAVAILABLE', () => {
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 3000, () => ({ measurement: faceLost(), objects: [personDet()] })));
  assert.equal(f.presence.status, PresenceStatus.PRESENT_FACE_UNAVAILABLE);
  assert.equal(f.presence.faceAvailable, false);
  assert.equal(f.objects.primaryPersonPresent, true);
  assert.notEqual(f.classification.state, AIState.TIDAK_HADIR);
  // The behavioural reading is not trustworthy while the face is unavailable.
  assert.equal(f.validity.stateSignalValid, false);
});

test('P4. THE v0.2 BUG: face lost + person visible NEVER becomes TIDAK_HADIR', () => {
  // The confirmed live failure: extreme yaw, body clearly visible, held long.
  const { ai, t0 } = calibratedAI();
  const frames = run(ai, t0, 15000, () => ({ measurement: faceLost(), objects: [personDet()] }));
  for (const f of frames) {
    assert.notEqual(f.classification.state, AIState.TIDAK_HADIR,
      'a visible user must never be reported absent');
  }
  const f = last(frames);
  assert.equal(f.presence.status, PresenceStatus.PRESENT_FACE_UNAVAILABLE);
  assert.equal(f.presence.bothMissingMs, 0, 'absence must not accumulate at all');
});

test('P5. transient loss of BOTH signals is not absence', () => {
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 1200, () => ({ measurement: faceLost(), objects: [] })));
  assert.notEqual(f.classification.state, AIState.TIDAK_HADIR);
  assert.equal(f.presence.status, PresenceStatus.MISSING_PENDING);
  assert.ok(f.presence.bothMissingMs > 0, 'but it does accumulate');
});

test('P6. sustained loss of BOTH signals -> TIDAK_HADIR', () => {
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 5000, () => ({ measurement: faceLost(), objects: [] })));
  assert.equal(f.presence.status, PresenceStatus.ABSENT);
  assert.equal(f.classification.state, AIState.TIDAK_HADIR);
  assert.equal(f.classification.primaryReason, StateReason.ABSENCE);
  assert.ok(f.presence.bothMissingMs >= CONFIG.presence.BOTH_MISSING_ENTER_MS);
});

test('P7. recovery from absence works', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 5000, () => ({ measurement: faceLost(), objects: [] }));
  assert.equal(ai.presenceFusion.status, PresenceStatus.ABSENT);

  const f = last(run(ai, t0 + 5000, 3000,
    () => ({ measurement: measurement(), objects: [personDet()] })));
  assert.equal(f.presence.status, PresenceStatus.PRESENT);
  assert.equal(f.classification.state, AIState.FOKUS);
});

test('P8. person-only recovery needs sustained presence', () => {
  // Weaker evidence than a face, so the recovery window applies.
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 5000, () => ({ measurement: faceLost(), objects: [] }));
  assert.equal(ai.presenceFusion.status, PresenceStatus.ABSENT);

  // A single person detection must not immediately clear absence.
  let t = t0 + 5000;
  const one = ai.processFrame(faceLost(), t, { objectDetections: [personDet()] });
  assert.equal(one.classification.state, AIState.TIDAK_HADIR);

  // Sustained person presence does.
  const f = last(run(ai, t + FRAME_MS, 2000,
    () => ({ measurement: faceLost(), objects: [personDet()] })));
  assert.notEqual(f.classification.state, AIState.TIDAK_HADIR);
});

// ── Primary-user association ────────────────────────────────────────────
test('P9. a background person is NOT adopted as the primary user', () => {
  const { ai, t0 } = calibratedAI();
  // Face lost; only a person off to the side, never associated with the user.
  const frames = run(ai, t0, 5000,
    () => ({ measurement: faceLost(), objects: [backgroundPersonDet()] }));
  const f = last(frames);
  // The remembered box was centre-frame; the background box neither overlaps
  // nor is near it, so it must not be promoted to "the user".
  assert.equal(f.objects.primaryPersonPresent, false,
    'an unassociated person must not count as the user');
  assert.equal(f.classification.state, AIState.TIDAK_HADIR);
});

test('P10. primary association survives short face loss', () => {
  const { ai, t0 } = calibratedAI();
  // Establish the primary box with the face visible.
  run(ai, t0, 1000, () => ({ measurement: measurement(), objects: [personDet()] }));
  // Lose the face; the same person box must still be tracked as the user.
  const f = last(run(ai, t0 + 1000, 3000,
    () => ({ measurement: faceLost(), objects: [personDet()] })));
  assert.equal(f.objects.primaryPersonPresent, true);
  assert.equal(f.presence.status, PresenceStatus.PRESENT_FACE_UNAVAILABLE);
});

test('P11. face anchors association when several people are visible', () => {
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 2000, () => ({
    measurement: measurement(),
    objects: [backgroundPersonDet(), personDet()],
  })));
  // The face centre (frame centre) lies inside the centre box, not the side one.
  assert.equal(f.objects.primaryPersonPresent, true);
  assert.equal(f.objects.associationMethod, 'FACE_CONTAINED');
});

test('P12. a lone person is adopted only when unambiguous', () => {
  const fusion = new PresenceFusion(CONFIG);
  // No prior primary user, no face, exactly one person -> adopt.
  const one = fusion.update({
    faceAvailable: false, faceCenter: null, personDetections: [personDet()],
  }, 0);
  assert.equal(one.primaryPersonPresent, true);
  assert.equal(one.associationMethod, 'SINGLE_PERSON_ADOPTED');

  // Two candidates with no prior anchor -> refuse to guess.
  const fresh = new PresenceFusion(CONFIG);
  const two = fresh.update({
    faceAvailable: false, faceCenter: null,
    personDetections: [personDet(), backgroundPersonDet()],
  }, 0);
  assert.equal(two.primaryPersonPresent, false);
  assert.equal(two.associationMethod, 'AMBIGUOUS_MULTIPLE_PERSONS');
});

test('P13. adoption can be disabled from config', () => {
  const cfg = withOverrides({ presence: { adoptSinglePersonWhenUnassociated: false } });
  const fusion = new PresenceFusion(cfg);
  const out = fusion.update({
    faceAvailable: false, faceCenter: null, personDetections: [personDet()],
  }, 0);
  assert.equal(out.primaryPersonPresent, false);
});

// ── Detector cadence tolerance ──────────────────────────────────────────
test('P14. detector not running is not "person absent"', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => ({ measurement: measurement(), objects: [personDet()] }));
  // null = throttled detector did not run this frame.
  const f = last(run(ai, t0 + 1000, 800, () => ({ measurement: faceLost(), objects: null })));
  assert.equal(f.objects.detectorRan, false);
  assert.equal(f.objects.primaryPersonPresent, true, 'held across the gap');
  assert.equal(f.presence.status, PresenceStatus.PRESENT_FACE_UNAVAILABLE);
});

test('P15. person-detector flicker does not flicker the state when face is present', () => {
  const { ai, t0 } = calibratedAI();
  let flips = 0, prev = null;
  const frames = run(ai, t0, 10000, (t) => ({
    measurement: measurement(),
    // Person appears and disappears every other frame.
    objects: Math.round((t - t0) / FRAME_MS) % 2 === 0 ? [personDet()] : [],
  }));
  for (const f of frames) {
    if (prev !== null && f.classification.state !== prev) flips++;
    prev = f.classification.state;
  }
  assert.equal(flips, 0, 'face presence alone keeps the state stable');
  assert.equal(last(frames).presence.status, PresenceStatus.PRESENT);
});

test('P16. tracking hold expires so a stale box cannot mask real absence', () => {
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 1000, () => ({ measurement: measurement(), objects: [personDet()] }));
  // Face gone, and the detector now genuinely reports no person.
  const f = last(run(ai, t0 + 1000, 6000, () => ({ measurement: faceLost(), objects: [] })));
  assert.equal(f.objects.primaryPersonPresent, false);
  assert.equal(f.classification.state, AIState.TIDAK_HADIR);
});

// ── Face AI must be untouched ───────────────────────────────────────────
test('P17. Face AI behaviour is unchanged by presence fusion', () => {
  const { ai, t0 } = calibratedAI();
  // Sustained yaw still yields TERALIH/YAW even with a person detected.
  const f = last(run(ai, t0, 9000, () => ({
    measurement: measurement({ yawRaw: REAL.yaw - 33.4 }), objects: [personDet()],
  })));
  assert.equal(f.classification.state, AIState.TERALIH);
  assert.equal(f.classification.primaryReason, StateReason.YAW);
});

test('P18. a detected person never produces FOKUS on its own', () => {
  // Person visible but face unavailable: we must NOT invent a behavioural
  // reading. State is held, and flagged as not observable.
  const { ai, t0 } = calibratedAI();
  run(ai, t0, 9000, () => ({
    measurement: measurement({ yawRaw: REAL.yaw - 40 }), objects: [personDet()],
  }));
  assert.equal(ai.stateEngine.state, AIState.TERALIH);

  const f = last(run(ai, t0 + 9000, 3000,
    () => ({ measurement: faceLost(), objects: [personDet()] })));
  assert.equal(f.validity.stateSignalValid, false,
    'state is not observable while the face is missing');
  assert.notEqual(f.classification.state, AIState.TIDAK_HADIR);
});

test('P19. presence telemetry keeps measurement separate from interpretation', () => {
  const { ai, t0 } = calibratedAI();
  const f = last(run(ai, t0, 1000, () => ({ measurement: faceLost(), objects: [personDet()] })));
  // Raw detector output.
  assert.ok(Array.isArray(f.objects.detections));
  assert.equal(f.objects.detections[0].category, 'person');
  assert.ok(Number.isFinite(f.objects.detections[0].confidence));
  // Derived interpretation, in its own section.
  assert.ok('status' in f.presence);
  assert.ok('bothMissingMs' in f.presence);
  assert.ok(!('status' in f.objects), 'interpretation must not leak into measurement');
});
