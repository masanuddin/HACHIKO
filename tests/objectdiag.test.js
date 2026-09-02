/**
 * v0.3 Gate-4 diagnostic tests — raw object-detector observability.
 *
 * Gate 4 failed live: a clearly visible person and a large phone both produced
 * NOTHING, while object inference was demonstrably running (28-34 ms). With no
 * visibility into raw model output, "the model saw nothing" and "the model saw
 * things we failed to identify" were indistinguishable.
 *
 * These tests lock in that distinction, and cover the identification fallback
 * that the investigation showed was missing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ObjectDetectorEngine, PresenceFusion, PhoneEventTracker,
  CONFIG, withOverrides,
} from '../src/ai/index.js';

/** A MediaPipe-shaped detection. */
const det = (index, categoryName, score, box = { originX: 10, originY: 20, width: 100, height: 200, angle: 0 }) => ({
  categories: [{ index, categoryName, displayName: categoryName, score }],
  boundingBox: box,
  keypoints: [],
});

const engine = (overrides = {}) =>
  new ObjectDetectorEngine(
    Object.keys(overrides).length ? withOverrides(overrides) : CONFIG,
    {}
  );

// ── Identification ──────────────────────────────────────────────────────
test('D1. detections are accepted when the label map works', () => {
  const eng = engine();
  const out = eng.normalize([det(0, 'person', 0.91), det(76, 'cell phone', 0.72)], 0);
  assert.equal(out.length, 2);
  assert.equal(out[0].category, 'person');
  assert.equal(out[0].resolvedBy, 'NAME');
  assert.equal(out[1].category, 'cell phone');
});

test('D2. EMPTY categoryName falls back to COCO index', () => {
  // MediaPipe builds categoryName as `labels[index] ?? ""`. When a model's
  // label map is not wired through at runtime the name is "" while `index`
  // still carries the true class. Name-only matching then drops EVERYTHING,
  // which looks exactly like "the detector sees nothing".
  const eng = engine();
  const out = eng.normalize([det(0, '', 0.91), det(76, '', 0.72), det(62, '', 0.65)], 0);
  assert.equal(out.length, 2, 'person and phone must still be recovered');
  assert.equal(out[0].category, 'person');
  assert.equal(out[0].resolvedBy, 'INDEX');
  assert.equal(out[1].category, 'cell phone');
  assert.equal(out[1].resolvedBy, 'INDEX');
});

test('D3. index fallback can be disabled from config', () => {
  const eng = engine({ objectDetector: { matchByIndexWhenNameMissing: false } });
  const out = eng.normalize([det(0, '', 0.91), det(76, '', 0.72)], 0);
  assert.equal(out.length, 0);
  assert.equal(eng.diagnostics.lastRejectReasons.UNRESOLVED_CATEGORY, 2);
});

test('D4. label spelling variants are tolerated', () => {
  const eng = engine();
  const out = eng.normalize([
    det(0, 'Person', 0.9), det(76, 'Cell Phone', 0.8), det(76, 'cell_phone', 0.7),
  ], 0);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((d) => d.category), ['person', 'cell phone', 'cell phone']);
});

test('D5. unrelated classes are still excluded', () => {
  const eng = engine();
  const out = eng.normalize([det(62, 'chair', 0.99), det(64, 'potted plant', 0.95)], 0);
  assert.equal(out.length, 0);
  assert.equal(eng.diagnostics.lastRejectReasons.OTHER_CATEGORY, 2);
});

// ── Zero-accepted is never unexplained ──────────────────────────────────
test('D6. confidence rejection is recorded with an explicit reason', () => {
  const eng = engine();
  const out = eng.normalize([det(0, 'person', 0.20), det(76, 'cell phone', 0.20)], 0);
  assert.equal(out.length, 0);
  assert.equal(eng.diagnostics.lastRejectReasons.PERSON_BELOW_CONFIDENCE, 1);
  assert.equal(eng.diagnostics.lastRejectReasons.PHONE_BELOW_CONFIDENCE, 1);
});

test('D7. "model saw nothing" is distinguishable from "we rejected everything"', () => {
  const eng = engine();

  eng.normalize([], 0);
  assert.deepEqual(eng.diagnostics.lastRejectReasons, {},
    'no rejects => the model genuinely returned nothing');

  eng.normalize([det(0, 'person', 0.2)], 0);
  assert.ok(Object.keys(eng.diagnostics.lastRejectReasons).length > 0,
    'rejects present => the model DID see something we dropped');
});

// ── Raw observability ───────────────────────────────────────────────────
test('D8. raw detections are captured BEFORE filtering', () => {
  const eng = engine();
  const raw = [det(62, 'chair', 0.99), det(0, 'person', 0.15), det(76, 'cell phone', 0.10)];
  eng._recordDiagnostics(raw, 1000, 30, { videoWidth: 640, videoHeight: 480 });
  const d = eng.getDiagnostics();

  assert.equal(d.rawDetectionCount, 3, 'all raw detections observable');
  assert.equal(d.lastRawDetections.length, 3);
  // Even classes we never accept remain visible for diagnosis.
  assert.ok(d.lastRawDetections.some((r) => r.categoryName === 'chair'));
  // Sorted by score, so the strongest evidence is easy to read.
  assert.ok(d.lastRawDetections[0].score >= d.lastRawDetections[1].score);
  assert.equal(d.lastVideoWidth, 640);
  assert.equal(d.lastVideoHeight, 480);
});

test('D9. diagnostics record inference count and timestamp', () => {
  const eng = engine();
  assert.equal(eng.getDiagnostics().objectInferenceCount, 0);
  eng._recordDiagnostics([det(0, 'person', 0.9)], 500, 28, {});
  eng._recordDiagnostics([], 650, 31, {});
  const d = eng.getDiagnostics();
  assert.equal(d.objectInferenceCount, 2);
  assert.equal(d.lastObjectInferenceTimestamp, 650);
  assert.equal(d.rawDetectionCount, 0, 'reflects the most recent inference');
});

test('D10. categoryNameAvailable reports whether the label map works', () => {
  const withNames = engine();
  withNames._recordDiagnostics([det(0, 'person', 0.9)], 0, 20, {});
  assert.equal(withNames.getDiagnostics().categoryNameAvailable, true);

  const withoutNames = engine();
  withoutNames._recordDiagnostics([det(0, '', 0.9)], 0, 20, {});
  assert.equal(withoutNames.getDiagnostics().categoryNameAvailable, false,
    'an empty runtime name must be reported, not silently tolerated');
});

test('D11. observed categories are tallied by index and name', () => {
  const eng = engine();
  eng._recordDiagnostics([det(0, 'person', 0.9), det(0, 'person', 0.8), det(76, '', 0.7)], 0, 20, {});
  const seen = eng.getDiagnostics().observedCategories;
  assert.equal(seen['0:person'], 2);
  assert.equal(seen['76:'], 1);
});

// ── Diagnostic mode is observation only ─────────────────────────────────
test('D12. diagnostic mode does not alter production config', () => {
  const diag = withOverrides({ objectDetector: { diagnosticMode: true } });
  assert.equal(diag.objectDetector.diagnosticMode, true);
  // The shared production config must be untouched.
  assert.equal(CONFIG.objectDetector.diagnosticMode, false);
  assert.equal(CONFIG.objectDetector.scoreThreshold, 0.30);
  assert.equal(CONFIG.objectDetector.minPersonConfidence, 0.40);
  assert.equal(CONFIG.objectDetector.minPhoneConfidence, 0.50);
  assert.deepEqual([...CONFIG.objectDetector.categoryAllowlist], ['person', 'cell phone']);
});

test('D13. diagnostic mode still applies acceptance filtering to consumers', () => {
  // The allowlist is dropped at the MODEL boundary so raw output is visible,
  // but normalize() must keep filtering what the pipeline consumes.
  const eng = engine({ objectDetector: { diagnosticMode: true } });
  const out = eng.normalize([det(62, 'chair', 0.99), det(0, 'person', 0.9)], 0);
  assert.equal(out.length, 1);
  assert.equal(out[0].category, 'person');
});

// ── Consumers only ever see accepted detections ─────────────────────────
test('D14. PresenceFusion consumes only accepted detections', () => {
  const eng = engine();
  const raw = [det(62, 'chair', 0.99), det(0, 'person', 0.9)];
  const accepted = eng.normalize(raw, 0);

  const fusion = new PresenceFusion(CONFIG);
  const out = fusion.update({
    faceAvailable: false, faceCenter: null, personDetections: accepted,
  }, 0);
  assert.equal(out.primaryPersonPresent, true, 'the person is used');
  // A chair can never be treated as a person.
  assert.ok(!accepted.some((d) => d.category === 'chair'));
});

test('D15. PhoneEventTracker consumes only accepted detections', () => {
  const eng = engine();
  const tracker = new PhoneEventTracker(CONFIG);
  const F = 1000 / 30;
  // A low-confidence phone is filtered out and must not open an event.
  for (let t = 0; t < 3000; t += F) {
    tracker.update(eng.normalize([det(76, 'cell phone', 0.20)], t), t);
  }
  assert.equal(tracker.getEvents().length, 0);

  // An accepted phone does.
  const tracker2 = new PhoneEventTracker(CONFIG);
  for (let t = 0; t < 3000; t += F) {
    tracker2.update(eng.normalize([det(76, 'cell phone', 0.85)], t), t);
  }
  assert.equal(tracker2.getEvents().length, 1);
});

test('D16. accepted detections carry identification provenance', () => {
  const eng = engine();
  const byName = eng.normalize([det(0, 'person', 0.9)], 0)[0];
  const byIndex = eng.normalize([det(0, '', 0.9)], 0)[0];
  assert.equal(byName.resolvedBy, 'NAME');
  assert.equal(byIndex.resolvedBy, 'INDEX');
  assert.equal(byName.categoryIndex, 0);
  // Shape stays exactly as consumers expect.
  for (const d of [byName, byIndex]) {
    assert.ok('category' in d && 'confidence' in d && 'boundingBox' in d && 'timestampMs' in d);
  }
});

test('D17. diagnostics never retain imagery', () => {
  const eng = engine();
  eng._recordDiagnostics([det(0, 'person', 0.9)], 0, 20, { videoWidth: 640, videoHeight: 480 });
  const json = JSON.stringify(eng.getDiagnostics());
  for (const banned of ['ImageData', 'data:image', 'blob:', 'canvas']) {
    assert.ok(!json.includes(banned), `diagnostics must not contain ${banned}`);
  }
  // Only numbers, labels and boxes.
  const [first] = eng.getDiagnostics().lastRawDetections;
  assert.deepEqual(Object.keys(first).sort(),
    ['boundingBox', 'categoryName', 'displayName', 'index', 'score', 'timestampMs']);
});
