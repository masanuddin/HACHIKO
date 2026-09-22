/**
 * Perception component freeze — the configuration DEVELOPMENT selected.
 *
 * 270 evaluable trials chose YOLO26n w8a32 as ONE detector serving both
 * Person and Phone, at an operating point of 0.30 for each. These tests
 * select nothing; they exist so a later edit that drifts the model, the
 * class mapping or the operating point fails here rather than silently
 * changing what the product perceives.
 *
 * Two properties recur:
 *   1. the accepted confidence IS the operating point — no second, higher
 *      threshold may sit below it;
 *   2. perception emits EVIDENCE, never a behavioral state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ObjectDetectorEngine, CONFIG } from '../src/ai/index.js';
import { verifyAsset } from '../tools/benchmark/assetIntegrity.js';

const OD = CONFIG.objectDetector;
const PERSON_IDX = OD.labelIndices.PERSON;
const PHONE_IDX = OD.labelIndices.PHONE;

/** A MediaPipe-shaped detection, which is what `normalize` consumes. */
const det = (index, categoryName, score) => ({
  categories: [{ index, categoryName, displayName: categoryName, score }],
  boundingBox: { originX: 10, originY: 20, width: 100, height: 200, angle: 0 },
  keypoints: [],
});

const engine = () => new ObjectDetectorEngine(CONFIG, {});

// ═══════════════════════════════════════════════════════════════════════
// §2 — model, mapping and thresholds
// ═══════════════════════════════════════════════════════════════════════
test('PF1. production selects the frozen YOLO26n model', () => {
  assert.match(OD.modelAssetPath, /yolo26n_w8a32\.tflite$/);
  assert.equal(OD.runtime, 'litert.js');
  // The product must not load its model out of the benchmark's gitignored
  // research directory — a fresh clone does not have one.
  assert.ok(!OD.modelAssetPath.includes('/bench/'));
  // And the superseded detector must be gone from the production path.
  assert.ok(!/efficientdet/i.test(OD.modelAssetPath));
});

test('PF2. the class mapping is YOLO\'s, not another model\'s', () => {
  assert.equal(PERSON_IDX, 0);
  assert.equal(PHONE_IDX, 67);
  // THE INDEX TRAP: 76 and 77 are EfficientDet/SSD phone indices. Under
  // COCO-80, 76 is `scissors` — a carried-over value would score scissors
  // as a phone without ever throwing.
  assert.notEqual(PHONE_IDX, 76);
  assert.notEqual(PHONE_IDX, 77);
});

test('PF3. both channels run at the frozen 0.30 operating point', () => {
  assert.equal(OD.minPersonConfidence, 0.30);
  assert.equal(OD.minPhoneConfidence, 0.30);
  // The model floor must not sit ABOVE the operating point, or detections
  // the operating point accepts would never reach it.
  assert.ok(OD.scoreThreshold <= OD.minPersonConfidence);
  assert.ok(OD.scoreThreshold <= OD.minPhoneConfidence);
  // One number, one meaning: no hidden second operating point.
  assert.equal(OD.minPersonConfidence, OD.minPhoneConfidence);
});

test('PF4. the model asset matches the DEVELOPMENT artefact exactly', async () => {
  const v = await verifyAsset('public/assets/yolo26n_w8a32.tflite', {
    sizeBytes: 2875553,
    sha256: 'd9cef07ce652ccfa9ce58e4ac8a4df98ff037739a9dad20a8afcae21b545df73',
  });
  assert.equal(v.ok, true,
    `production model must be the benchmarked artefact: ${v.errors.join('; ')}`);
  assert.deepEqual(v.checked, ['size', 'sha256']);
});

// ═══════════════════════════════════════════════════════════════════════
// §9 — threshold boundaries, at >= 0.30
// ═══════════════════════════════════════════════════════════════════════
test('PF5. presence accepts at exactly 0.30 and rejects just below', () => {
  const eng = engine();
  assert.equal(eng.normalize([det(PERSON_IDX, 'person', 0.2999)], 0).length, 0,
    '0.2999 must be rejected');
  assert.equal(eng.normalize([det(PERSON_IDX, 'person', 0.30)], 0).length, 1,
    'the boundary itself is accepted (>= 0.30)');
  assert.equal(eng.normalize([det(PERSON_IDX, 'person', 0.85)], 0).length, 1);
});

test('PF6. phone accepts at exactly 0.30 and rejects just below', () => {
  const eng = engine();
  assert.equal(eng.normalize([det(PHONE_IDX, 'cell phone', 0.2999)], 0).length, 0);
  assert.equal(eng.normalize([det(PHONE_IDX, 'cell phone', 0.30)], 0).length, 1);
  assert.equal(eng.normalize([det(PHONE_IDX, 'cell phone', 0.77)], 0).length, 1);
});

test('PF7. a rejection below the operating point is explained, not silent', () => {
  const eng = engine();
  eng.normalize([det(PERSON_IDX, 'person', 0.10),
    det(PHONE_IDX, 'cell phone', 0.10)], 0);
  assert.equal(eng.diagnostics.lastRejectReasons.PERSON_BELOW_CONFIDENCE, 1);
  assert.equal(eng.diagnostics.lastRejectReasons.PHONE_BELOW_CONFIDENCE, 1);
});

// ═══════════════════════════════════════════════════════════════════════
// §9 — class isolation
// ═══════════════════════════════════════════════════════════════════════
test('PF8. person is never read as phone, and phone never as person', () => {
  const eng = engine();
  const out = eng.normalize([
    det(PERSON_IDX, 'person', 0.90),
    det(PHONE_IDX, 'cell phone', 0.80),
  ], 0);
  assert.equal(out.length, 2);
  const byCat = Object.fromEntries(out.map((d) => [d.category, d.confidence]));
  assert.equal(byCat.person, 0.90);
  assert.equal(byCat['cell phone'], 0.80);
});

test('PF9. index 76 is NOT a phone under the frozen mapping', () => {
  // The specific silent failure the freeze guards. Resolution is by index
  // when the runtime name is empty, so a stale 76 would surface here.
  const eng = engine();
  const out = eng.normalize([det(76, '', 0.95)], 0);
  assert.equal(out.length, 0, 'COCO-80 index 76 is scissors, not a phone');
});

test('PF10. unrelated classes are ignored for both channels', () => {
  const eng = engine();
  const out = eng.normalize([
    det(62, 'chair', 0.99), det(63, 'laptop', 0.97),
    det(65, 'remote', 0.96), det(73, 'book', 0.95),
  ], 0);
  assert.equal(out.length, 0);
  assert.equal(eng.diagnostics.lastRejectReasons.OTHER_CATEGORY, 4);
});

// ═══════════════════════════════════════════════════════════════════════
// §7 / §9 — perception emits evidence, never a behavioral state
// ═══════════════════════════════════════════════════════════════════════
test('PF11. a phone detection carries no behavioral state', () => {
  const eng = engine();
  const [phone] = eng.normalize([det(PHONE_IDX, 'cell phone', 0.95)], 0);
  assert.equal(phone.category, 'cell phone');
  assert.equal(typeof phone.confidence, 'number');
  // Perception output must not name a state. Whether a phone means TERALIH
  // depends on the declared study medium and on temporal context, which the
  // behavioral layer owns.
  for (const banned of ['state', 'teralih', 'TERALIH', 'distracted', 'verdict']) {
    assert.ok(!(banned in phone),
      `a detection must not carry "${banned}"`);
  }
  assert.ok(!JSON.stringify(phone).includes('TERALIH'));
});

test('PF12. the detector module never references a behavioral state', () => {
  const src = readFileSync(
    new URL('../src/ai/pipeline/ObjectDetectorEngine.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['TERALIH', 'TIDAK_HADIR', 'AIState', 'StateEngine']) {
    assert.ok(!code.includes(banned),
      `perception must not decide behavior (found ${banned})`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// §11 — benchmark / production parity
// ═══════════════════════════════════════════════════════════════════════
test('PF13. production and benchmark agree on model, mapping and runtime', async () => {
  const { CANDIDATES } = await import('../tools/benchmark/candidates.js');
  const bench = CANDIDATES.find((c) => c.id === 'yolo26n');

  // Same artefact filename, same class indices, same runtime.
  assert.ok(OD.modelAssetPath.endsWith(bench.file));
  assert.deepEqual(OD.labelIndices, bench.labelIndices);
  assert.equal(OD.runtime, bench.runtime);
  // Input resolution is the model's, and must not be re-specified elsewhere.
  assert.equal(bench.inputWidth, 640);
  assert.equal(bench.inputHeight, 640);
});

// ═══════════════════════════════════════════════════════════════════════
// §8 — the behavioral freeze is untouched
// ═══════════════════════════════════════════════════════════════════════
test('PF14. this freeze did not move any behavioral parameter', () => {
  const S = CONFIG.state;
  const E = CONFIG.eye.eligibility;
  assert.equal(S.STRONG_YAW_DELTA_DEG, 25);
  assert.equal(S.YAW_PERSIST_MS, 1500);
  assert.equal(S.STRONG_UP_PITCH_DELTA_DEG, 30);
  assert.equal(S.PITCH_UP_PERSIST_MS, 2000);
  assert.equal(S.DOWN_PITCH_SUPPORT_DEG, 10);
  assert.equal(S.DOWN_PITCH_SUPPORT_PERSIST_MS, 2000);
  assert.equal(S.ROLL_SUPPORT_DEG, 22);
  assert.equal(S.ROLL_SUPPORT_PERSIST_MS, 2000);
  assert.equal(S.EAR_RELATIVE_THRESHOLD, 0.70);
  assert.equal(S.EYE_CLOSED_PERSIST_MS, 3000);
  assert.equal(E.EYE_MAX_ABS_PITCH_DEG, 10);
  assert.equal(E.EYE_MAX_ABS_YAW_DEG, 20);
  assert.equal(E.EYE_MAX_LR_RATIO, 1.6);
  assert.equal(CONFIG.validity.SIGNAL_INVALID_GRACE_MS, 1000);
  assert.equal(CONFIG.temporal.EMA_ALPHA, 0.35);
});

test('PF15. phone temporal persistence was not re-frozen here', () => {
  // These pre-date this task and must be unchanged: the numbers that decide
  // whether a phone becomes behavioral evidence belong to full-system
  // integration, not to the perception freeze.
  assert.equal(CONFIG.phoneEvents.PHONE_ENTER_MS, 400);
  assert.equal(CONFIG.phoneEvents.PHONE_EXIT_GRACE_MS, 900);
});
