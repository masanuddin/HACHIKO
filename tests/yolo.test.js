/**
 * YOLO26n benchmark adapter (spec §D/§E).
 *
 * The rule under test: a second inference RUNTIME may differ, but the
 * PROTOCOL may not. YOLO must land in HACHIKO's canonical observation shape,
 * resolve its own class ids, and fail loudly rather than silently.
 *
 * No camera, no network, no model file: the official package is injected as a
 * fake, so these run anywhere. Live loading is covered by the integration
 * path, not here.
 *
 * No AI parameter is read or changed here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  resolveClassIds, toCanonicalObservation, YoloBenchmarkModel,
} from '../tools/benchmark/yoloAdapter.js';
import { CANDIDATES } from '../tools/benchmark/candidates.js';
import { BenchmarkRunner } from '../tools/benchmark/BenchmarkRunner.js';

/** The REAL 80-class COCO ordering, as read from yolo26n's own metadata. */
const COCO80 = {
  0: 'person', 1: 'bicycle', 2: 'car', 24: 'backpack', 39: 'bottle',
  63: 'laptop', 64: 'mouse', 65: 'remote', 66: 'keyboard', 67: 'cell phone',
  73: 'book', 76: 'scissors', 77: 'teddy bear',
};

const box = (cls, conf, name, xy = [0, 0, 10, 10]) => ({
  cls, conf, name, x1: xy[0], y1: xy[1], x2: xy[2], y2: xy[3],
});

const yolo26n = () => CANDIDATES.find((c) => c.id === 'yolo26n');

/** A stand-in for the official package: no wasm, no GPU, no file. */
function fakeYOLO({ names = COCO80, device = 'webgpu', boxes = [],
  loadMs = 0, failLoad = null, failPredict = null } = {}) {
  return {
    load: async () => {
      if (failLoad) throw new Error(failLoad);
      return {
        names, device, task: 'detect',
        predict: async () => {
          if (failPredict) throw new Error(failPredict);
          return { task: 'detect', boxes, speed: { preprocess: 1, inference: 7, postprocess: 2 } };
        },
        free() {},
      };
    },
    _loadMs: loadMs,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// §8 / §9 — registration and canonical identity
// ═══════════════════════════════════════════════════════════════════════
test('Y1. YOLO26n is registered as an additional candidate, replacing none', () => {
  const ids = CANDIDATES.map((c) => c.id);
  // Every pre-existing candidate must survive.
  for (const keep of ['edl0-f16', 'edl2-f16', 'ssd-mnv2-f32', 'pose-lite']) {
    assert.ok(ids.includes(keep), `${keep} must not be removed`);
  }
  assert.ok(ids.includes('yolo26n'), 'yolo26n must be registered');
  assert.equal(ids.length, 5);
  // Registry order is the display order; YOLO is appended, not promoted.
  assert.equal(ids[ids.length - 1], 'yolo26n');
});

test('Y2. YOLO26n exports a deterministic canonical identity', () => {
  const c = yolo26n();
  assert.equal(c.label, 'YOLO26n Detect');
  assert.equal(c.task, 'object');
  assert.equal(c.runtime, 'litert.js', 'a second runtime, declared');
  assert.equal(c.inputWidth, 640);
  assert.equal(c.inputHeight, 640);
});

test('Y2b. provenance names the exact official release asset', () => {
  const c = yolo26n();
  // The artefact is an OFFICIAL Ultralytics release asset, not a local export.
  assert.equal(c.sourceRepo, 'ultralytics/yolo-flutter-app');
  assert.equal(c.sourceRelease, 'v0.6.6');
  assert.equal(c.sourceAsset, 'yolo26n_w8a32.tflite');
  // Kept under its upstream name so the bytes on disk stay traceable.
  assert.equal(c.file, 'yolo26n_w8a32.tflite');
  assert.ok(!/float32/.test(c.file), 'the artefact must not be renamed');

  // Measured from the downloaded bytes, not copied off a web page.
  assert.equal(c.sizeBytes, 2875553);
  assert.match(c.sha256, /^[0-9a-f]{64}$/);

  // Published upstream, so there is no local export tool to credit.
  assert.equal(c.exportToolVersion, null);
  assert.match(c.exportProvenance, /official Ultralytics release/i);

  // Browser runtime, pinned.
  assert.match(c.browserRuntimeVersion, /^@ultralytics\/yolo@\d/);
  assert.match(c.litertRuntimeVersion, /^@litertjs\/core@\d/);
  // No single collapsed "version" field may stand in for these.
  assert.equal(c.sourceVersion, undefined);
});

test('Y2c. quantisation is stated explicitly, never inferred from the name', () => {
  const c = yolo26n();
  // w8a32 is neither the float32 graph nor a full INT8 build. The MediaPipe
  // candidates are float16, so leaving this implicit would invite a
  // precision comparison nobody measured.
  assert.equal(c.quantization, 'w8a32');
  assert.match(c.quantizationNote, /INT8 weights.*FP32 activations/i);
  assert.equal(c.inputWidth, 640, 'input size is unchanged by quantisation');
  assert.equal(c.inputHeight, 640);
});

// ═══════════════════════════════════════════════════════════════════════
// §10 / §11 / §12 — class mapping, read from the model
// ═══════════════════════════════════════════════════════════════════════
test('Y3. person and cell phone resolve from the model\'s own names', () => {
  const { personId, phoneId, mismatches } =
    resolveClassIds(COCO80, yolo26n().labelIndices);
  assert.equal(personId, 0);
  assert.equal(phoneId, 67, 'COCO-80 puts cell phone at 67, not 76');
  assert.deepEqual(mismatches, [], 'registry agrees with the model');
});

test('Y4. a registry index that disagrees with the model is reported', () => {
  // The failure this guards is silent: EfficientDet's 76 is a VALID index in
  // COCO-80 — it is `scissors` — so a wrong value scores scissors as a phone
  // for an entire benchmark without ever throwing.
  const { phoneId, mismatches } =
    resolveClassIds(COCO80, { PERSON: 0, PHONE: 76 });
  assert.equal(phoneId, 67, 'the model wins, never the registry');
  assert.equal(mismatches.length, 1);
  assert.match(mismatches[0], /phone: registry 76, model 67/);
});

test('Y5. a model without the target classes is refused, not guessed', () => {
  assert.throws(() => resolveClassIds({ 0: 'cat', 1: 'dog' }), /no "person"/);
  assert.throws(() => resolveClassIds({ 0: 'person' }), /no "cell phone"/);
  assert.throws(() => resolveClassIds(null), /no class names/);
});

test('Y6. unrelated classes never become person or phone', () => {
  const obs = toCanonicalObservation({
    boxes: [
      box(65, 0.91, 'remote'), box(76, 0.88, 'scissors'),
      box(63, 0.80, 'laptop'), box(73, 0.70, 'book'),
    ],
  }, { personId: 0, phoneId: 67 });

  assert.equal(obs.personDetected, false);
  assert.equal(obs.phoneDetected, false, 'scissors at 76 is not a phone');
  assert.equal(obs.personMaxScore, null);
  assert.equal(obs.phoneMaxScore, null);
  // They are still reported as competition, which is the point of topOther.
  assert.equal(obs.topOther.length, 4);
  assert.equal(obs.topOther[0].categoryName, 'remote');
});

// ═══════════════════════════════════════════════════════════════════════
// §13 — the canonical benchmark detection format
// ═══════════════════════════════════════════════════════════════════════
test('Y7. YOLO output becomes the same shape every other detector produces', () => {
  const obs = toCanonicalObservation({
    boxes: [box(0, 0.93, 'person', [10, 20, 110, 220]),
      box(67, 0.42, 'cell phone', [5, 5, 25, 45]),
      box(65, 0.31, 'remote')],
  }, { personId: 0, phoneId: 67 });

  assert.equal(obs.task, 'object');
  assert.equal(obs.personDetected, true);
  assert.equal(obs.personMaxScore, 0.93);
  assert.equal(obs.phoneDetected, true);
  assert.equal(obs.phoneMaxScore, 0.42);
  assert.equal(obs.rawCount, 3);

  // xyxy is converted to the origin/width/height form the others report.
  const person = obs.detections.find((d) => d.isPerson);
  assert.deepEqual(person.boundingBox,
    { originX: 10, originY: 20, width: 100, height: 200 });

  // Sorted strongest-first, like _observeObject.
  assert.deepEqual(obs.detections.map((d) => d.score), [0.93, 0.42, 0.31]);
  // Every key the recorder reads must exist.
  for (const k of ['task', 'rawCount', 'detections', 'personDetected',
    'personMaxScore', 'phoneDetected', 'phoneMaxScore', 'topOther']) {
    assert.ok(k in obs, `canonical observation missing "${k}"`);
  }
});

test('Y8. the strongest instance of a class wins, and scores pass through', () => {
  const obs = toCanonicalObservation({
    boxes: [box(0, 0.40, 'person'), box(0, 0.88, 'person'), box(0, 0.10, 'person')],
  }, { personId: 0, phoneId: 67 });
  assert.equal(obs.personMaxScore, 0.88);
  // NOT rescaled, NOT normalised against any other family.
  assert.ok(obs.detections.every((d) => [0.88, 0.40, 0.10].includes(d.score)));
});

test('Y9. malformed boxes are skipped rather than scored', () => {
  const obs = toCanonicalObservation({
    boxes: [null, {}, box(0, NaN, 'person'), box(0, 0.5, 'person')],
  }, { personId: 0, phoneId: 67 });
  assert.equal(obs.detections.length, 1);
  assert.equal(obs.personMaxScore, 0.5);
});

test('Y10. an empty or absent result is no detection, never a crash', () => {
  for (const r of [{ boxes: [] }, {}, null]) {
    const obs = toCanonicalObservation(r, { personId: 0, phoneId: 67 });
    assert.equal(obs.personDetected, false);
    assert.equal(obs.phoneDetected, false);
    assert.equal(obs.detections.length, 0);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// §14 / §15 / §16 — failure behaviour and exported metadata
// ═══════════════════════════════════════════════════════════════════════
test('Y11. the runtime and backend that ACTUALLY ran are recorded', async () => {
  let t = 100;
  const m = await YoloBenchmarkModel.load(
    { YOLO: fakeYOLO({ device: 'cpu' }) }, '/m.tflite', yolo26n(),
    { device: 'auto', now: () => (t += 25) });

  const meta = m.describe();
  // We asked for "auto" and got CPU. The report must say CPU.
  assert.equal(meta.delegate, 'cpu', 'the backend is read back, not assumed');
  assert.equal(meta.runtime, 'litert.js');
  assert.equal(meta.modelId, 'yolo26n');
  assert.equal(meta.classCount, Object.keys(COCO80).length);
  assert.equal(meta.personClassId, 0);
  assert.equal(meta.phoneClassId, 67);
});

test('Y12. size and input dimensions reach the exported metadata', async () => {
  const m = await YoloBenchmarkModel.load(
    { YOLO: fakeYOLO() }, '/m.tflite', yolo26n(), { now: () => 0 });
  const meta = m.describe();
  assert.equal(meta.inputWidth, 640);
  assert.equal(meta.inputHeight, 640);
  assert.equal(meta.sizeBytes, yolo26n().sizeBytes);
  assert.equal(meta.sourceRelease, 'v0.6.6');
  assert.equal(meta.exportToolVersion, null, 'no local export tool to credit');
});

test('Y13. load time and warm-up are measured apart from inference', async () => {
  let clock = 0;
  const m = await YoloBenchmarkModel.load(
    { YOLO: fakeYOLO() }, '/m.tflite', yolo26n(),
    { now: () => (clock += 40) });           // load spans two reads
  assert.equal(m.describe().modelLoadMs, 40);
  assert.equal(m.describe().warmupMs, null, 'not warmed up yet');

  await m.warmup({}, { now: () => (clock += 15) });
  assert.equal(m.describe().warmupMs, 15);

  // Steady-state timing comes from the engine, and is a different number.
  const obs = await m.observe({});
  assert.equal(obs.engineInferenceMs, 7);
  assert.notEqual(obs.engineInferenceMs, m.describe().modelLoadMs);
});

test('Y14. a failed load surfaces the reason instead of substituting a model', async () => {
  await assert.rejects(
    YoloBenchmarkModel.load({ YOLO: fakeYOLO({ failLoad: 'no webgpu adapter' }) },
      '/m.tflite', yolo26n(), { now: () => 0 }),
    /no webgpu adapter/);

  // Missing package is equally explicit — never a silent fallback.
  await assert.rejects(
    YoloBenchmarkModel.load({}, '/m.tflite', yolo26n()),
    /@ultralytics\/yolo not provided/);
});

test('Y15. a failed warm-up is raised, not swallowed', async () => {
  const m = await YoloBenchmarkModel.load(
    { YOLO: fakeYOLO({ failPredict: 'tensor rank unsupported' }) },
    '/m.tflite', yolo26n(), { now: () => 0 });
  await assert.rejects(m.warmup({}), /warm-up failed: tensor rank unsupported/);
});

test('Y16. YOLO receives the same diagnostic floor as every other candidate', async () => {
  const seen = [];
  const YOLO = {
    load: async () => ({
      names: COCO80, device: 'webgpu', task: 'detect',
      predict: async (_f, o) => { seen.push(o); return { boxes: [] }; },
      free() {},
    }),
  };
  const m = await YoloBenchmarkModel.load({ YOLO }, '/m.tflite', yolo26n(),
    { now: () => 0 });
  await m.observe({});
  // 0.05 is BENCH_SCORE_THRESHOLD: a diagnostic floor, not an operating point,
  // and not a more generous cut-off than the MediaPipe candidates get.
  assert.equal(seen[0].conf, 0.05);
});

test('Y17. the adapter re-implements no decode, NMS or letterbox maths', () => {
  // The official package owns that in shared Rust. A second implementation
  // here would be a second source of truth for the same detections.
  const src = readFileSync(
    new URL('../tools/benchmark/yoloAdapter.js', import.meta.url), 'utf8');
  // Strip comments first: the header DISCUSSES letterboxing and NMS to explain
  // why they are absent, and a naive substring check would flag that prose.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['letterbox', 'nonMaxSuppression', 'sigmoid', 'Float32Array']) {
    assert.ok(!code.includes(banned), `adapter must not implement ${banned}`);
  }
  assert.ok(!/8400|numClasses|anchor/i.test(code), 'no raw tensor decode');
});

// ═══════════════════════════════════════════════════════════════════════
// §AS — a runtime that cannot start is recorded, never swapped out
// ═══════════════════════════════════════════════════════════════════════
test('Y18. an unavailable YOLO runtime is an explicit MODEL_INIT_ERROR', async () => {
  // No adapter injected: the exact situation when the hand-exported .tflite
  // or the LiteRT package is absent on the page.
  const r = new BenchmarkRunner({});
  await assert.rejects(r.load('yolo26n'), /MODEL_INIT_ERROR/);
  // And it must not have quietly loaded something else instead.
  assert.equal(r.activeId, null, 'no candidate is substituted');
  assert.equal(r.loaded.size, 0);
});

test('Y19. a failed YOLO attempt is preserved as auditable evidence', () => {
  const r = new BenchmarkRunner({});
  const a = r.recordInvalidAttempt({
    task: 'person', scenarioId: 'frontal_seated', modelId: 'yolo26n',
    repetition: 1, reason: 'MODEL_INIT_ERROR: litert runtime unavailable',
  });
  assert.equal(a.valid, false);
  assert.equal(a.modelId, 'yolo26n');
  assert.match(a.reason, /MODEL_INIT_ERROR/);
  // It counts as an attempt, never as one of the three evaluable repetitions.
  const s = r.getAttemptSummary();
  assert.equal(s.evaluableTrials, 0);
  assert.equal(s.invalidAttempts, 1);
  assert.equal(s.totalAttempts, 1);
});

// ═══════════════════════════════════════════════════════════════════════
// §1 — the REAL browser dependency chain, not the injected fake
// ═══════════════════════════════════════════════════════════════════════
// The fakes above prove the adapter's logic. They prove nothing about whether
// a browser can resolve @ultralytics/yolo, so these check the real wiring:
// pinned in package.json, pinned in the lockfile, vendored into public/, and
// reachable by the exact specifiers the page uses.
test('Y20. the YOLO runtime is pinned in package.json and the lockfile', () => {
  const pkg = JSON.parse(readFileSync(
    new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(
    new URL('../package-lock.json', import.meta.url), 'utf8'));

  for (const dep of ['@ultralytics/yolo', '@litertjs/core']) {
    const want = pkg.dependencies?.[dep];
    assert.ok(want, `${dep} must be a declared dependency`);
    // Exact, not a range: a benchmark must be re-runnable against the same
    // runtime months later.
    assert.match(want, /^\d+\.\d+\.\d+$/, `${dep} must be pinned exactly`);
    const entry = lock.packages?.[`node_modules/${dep}`];
    assert.ok(entry, `${dep} must be resolved in the lockfile`);
    assert.equal(entry.version, want, `${dep} lockfile version must match`);
    assert.ok(entry.integrity, `${dep} must carry an integrity hash`);
  }
  // Pulled in transitively, and required by the import map.
  assert.ok(lock.packages?.['node_modules/@litertjs/wasm-utils'],
    '@litertjs/wasm-utils must be resolved too');
});

test('Y21. the page resolves the runtime from vendored files, not a CDN', () => {
  const html = readFileSync(
    new URL('../public/benchmark.html', import.meta.url), 'utf8');

  // @litertjs/core imports "@litertjs/wasm-utils" as a BARE specifier, which
  // no browser resolves without this map.
  assert.match(html, /<script type="importmap">/);
  assert.match(html, /"@litertjs\/core":\s*"\/public\/assets\//);
  assert.match(html, /"@litertjs\/wasm-utils":\s*"\/public\/assets\//);
  // Everything is served from this origin.
  assert.ok(!/cdn\.jsdelivr|unpkg\.com|esm\.sh/.test(html),
    'no CDN may supply the benchmark runtime');
  assert.match(html, /\/public\/assets\/ultralytics-yolo\/dist\/index\.js/);
  assert.match(html, /litertWasmPath:\s*'\/public\/assets\/litertjs\/wasm\//);
});

test('Y22. the real @ultralytics/yolo module loads and exports YOLO.load', async () => {
  // The actual bytes the page will serve — no fake, no injection.
  const mod = await import('../public/assets/ultralytics-yolo/dist/index.js');
  assert.equal(typeof mod.YOLO, 'function', 'the real package exports YOLO');
  assert.equal(typeof mod.YOLO.load, 'function', 'with the loader we call');
  // Its relative "../pkg/..." import must resolve inside the vendored tree.
  for (const rel of ['../public/assets/ultralytics-yolo/pkg/ultralytics_inference_web.js',
    '../public/assets/litertjs/core.js', '../public/assets/litertjs/wasm-utils.js']) {
    assert.ok(readFileSync(new URL(rel, import.meta.url), 'utf8').length > 0,
      `${rel} must be vendored`);
  }
});

test('Y23. the registry matches what the real browser runtime reported', () => {
  // Recorded from a headless Chrome run against the OFFICIAL artefact served
  // over HTTP (public/assets/bench/yolo26n_w8a32.tflite, 2,875,553 bytes):
  //
  //   task "detect" | device "cpu" | classCount 80
  //   person 0 | cell phone 67
  //   load 224 ms | steady-state 151-173 ms (median 163)
  //   speed { preprocess 3.7, inference 156.6, postprocess 0.9 }
  //
  // The .tflite embeds no label table, so the runtime supplied the COCO-80
  // map. This test pins the registry to what that run actually observed; if
  // the asset is ever swapped, resolveClassIds reports the disagreement.
  const c = yolo26n();
  assert.equal(c.labelIndices.PERSON, 0);
  assert.equal(c.labelIndices.PHONE, 67);
  assert.equal(c.task, 'object', 'a detect model fills the object task');
  assert.equal(c.runtime, 'litert.js');
  // "auto" was requested and CPU actually ran, which is why the recorded
  // delegate comes from model.device rather than from this field.
  assert.equal(c.delegate, 'auto');
});
