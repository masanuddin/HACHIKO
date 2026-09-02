/**
 * v0.2.1 tests — architectural boundaries.
 *
 * These assert STRUCTURE, not behaviour. They exist so the separation survives
 * future edits: a violation fails CI rather than being noticed in review.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import * as PublicAPI from '../src/ai/index.js';
import { HachikoAI, CONFIG, FaceLandmarkerEngine } from '../src/ai/index.js';
import { TelemetryLogger } from '../tools/telemetry/TelemetryLogger.js';

const SRC_AI = new URL('../src/ai/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Every .js file under src/ai, recursively. */
function coreFiles(dir = SRC_AI, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) coreFiles(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Source with comments stripped.
 *
 * These boundary checks must inspect CODE, not prose. The core's own doc
 * comments legitimately mention `getUserMedia` (to state that it never calls
 * it) and the word "window" (the calibration window), and matching those would
 * make the guard fire on correct, well-documented code.
 */
function codeOf(file) {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (leave URLs alone)
}

// ── Directory layout ────────────────────────────────────────────────────
test('debug and telemetry tools live outside src/ai', () => {
  assert.ok(existsSync(new URL('../tools/debug/DebugHarness.js', import.meta.url)));
  assert.ok(existsSync(new URL('../tools/telemetry/TelemetryLogger.js', import.meta.url)));
  for (const f of coreFiles()) {
    assert.ok(!/DebugHarness|TelemetryLogger/.test(f),
      `${f} must not live inside the AI core`);
  }
});

// ── Framework agnosticism ───────────────────────────────────────────────
test('the AI core imports no framework and no tool', () => {
  const banned = [
    /from\s+['"]react/i,
    /from\s+['"]@tauri/i,
    /from\s+['"]vue/i,
    /from\s+['"]svelte/i,
    /\.\.\/\.\.\/tools\//,
    /from\s+['"].*DebugHarness/,
    /from\s+['"].*TelemetryLogger/,
  ];
  for (const file of coreFiles()) {
    const src = codeOf(file);
    for (const pattern of banned) {
      assert.ok(!pattern.test(src), `${file} violates the boundary: ${pattern}`);
    }
  }
});

test('the AI core never requests camera permission', () => {
  // getUserMedia belongs to the host app (or the standalone debug harness).
  for (const file of coreFiles()) {
    assert.ok(!/getUserMedia|mediaDevices/.test(codeOf(file)),
      `${file} must not touch camera permission APIs`);
  }
});

test('only FaceLandmarkerEngine touches the DOM, and only via a passed element', () => {
  for (const file of coreFiles()) {
    if (file.endsWith('FaceLandmarkerEngine.js')) continue;
    assert.ok(!/\bdocument\.|\bwindow\.[a-zA-Z]|createElement\(/.test(codeOf(file)),
      `${file} must not reach into the DOM`);
  }
});

// ── HachikoAI surface ───────────────────────────────────────────────────
test('HachikoAI does not own telemetry storage', () => {
  const ai = new HachikoAI(CONFIG);
  assert.equal(ai.telemetry, undefined, 'no logger instance on the core');
  assert.equal(typeof ai.getTelemetry, 'undefined', 'no storage accessor');
  assert.equal(typeof ai.onFrame, 'function', 'emission is the output channel');
  assert.equal(typeof ai.getSessionInfo, 'function', 'provenance is exposed');
});

test('HachikoAI does not own camera lifecycle', () => {
  const ai = new HachikoAI(CONFIG);
  for (const method of ['start', 'stop', 'startCamera', 'stopCamera', 'requestCamera']) {
    assert.equal(typeof ai[method], 'undefined',
      `HachikoAI must not expose ${method}()`);
  }
});

test('onFrame delivers frames and unsubscribes cleanly', () => {
  const ai = new HachikoAI(CONFIG);
  const seen = [];
  const off = ai.onFrame((f) => seen.push(f));
  const m = {
    facePresent: true, poseValid: true, poseInvalidReason: 'NONE',
    yawRaw: 0, pitchRaw: 0, rollRaw: 0,
    earLeft: 0.3, earRight: 0.3, earMean: 0.3,
  };
  ai.processFrame(m, 0);
  ai.processFrame(m, 33);
  assert.equal(seen.length, 2);
  off();
  ai.processFrame(m, 66);
  assert.equal(seen.length, 2, 'unsubscribe must stop delivery');
});

test('a throwing listener cannot break inference', () => {
  const ai = new HachikoAI(CONFIG);
  ai.onFrame(() => { throw new Error('consumer bug'); });
  const good = [];
  ai.onFrame((f) => good.push(f));
  const m = {
    facePresent: true, poseValid: true, poseInvalidReason: 'NONE',
    yawRaw: 0, pitchRaw: 0, rollRaw: 0,
    earLeft: 0.3, earRight: 0.3, earMean: 0.3,
  };
  const frame = ai.processFrame(m, 0);
  assert.ok(frame.classification, 'processFrame still returns a frame');
  assert.equal(good.length, 1, 'other listeners still receive it');
});

// ── TelemetryLogger as a consumer ───────────────────────────────────────
test('TelemetryLogger attaches to the AI without the AI knowing', () => {
  const ai = new HachikoAI(CONFIG);
  const logger = new TelemetryLogger(CONFIG);
  const detach = logger.attach(ai);

  const m = {
    facePresent: true, poseValid: true, poseInvalidReason: 'NONE',
    yawRaw: 0, pitchRaw: 0, rollRaw: 0,
    earLeft: 0.3, earRight: 0.3, earMean: 0.3,
  };
  ai.processFrame(m, 0);
  ai.processFrame(m, 33);
  assert.equal(logger.length, 2);

  detach();
  ai.processFrame(m, 66);
  assert.equal(logger.length, 2, 'detach stops recording');
});

test('attach() captures config provenance from the AI', () => {
  const ai = new HachikoAI(CONFIG);
  const logger = new TelemetryLogger(CONFIG);
  logger.attach(ai, { device: 'test-rig' });
  assert.equal(logger.sessionMeta.device, 'test-rig');
  assert.equal(
    logger.sessionMeta.config.state.STRONG_YAW_DELTA_DEG,
    CONFIG.state.STRONG_YAW_DELTA_DEG,
    'thresholds that produced the log must be recorded with it');
});

// ── Injectable asset paths ──────────────────────────────────────────────
test('model and WASM paths are injectable, overriding config', () => {
  const engine = new FaceLandmarkerEngine(CONFIG, {
    FilesetResolver: {}, FaceLandmarker: {},
    assetPaths: { modelAssetPath: 'https://cdn.example/m.task', wasmPath: '/custom/wasm' },
  });
  assert.equal(engine.assetPaths.modelAssetPath, 'https://cdn.example/m.task');
  assert.equal(engine.assetPaths.wasmPath, '/custom/wasm');
});

test('asset paths fall back to config when not injected', () => {
  const engine = new FaceLandmarkerEngine(CONFIG, {
    FilesetResolver: {}, FaceLandmarker: {},
  });
  assert.equal(engine.assetPaths.modelAssetPath, CONFIG.landmarker.modelAssetPath);
  assert.equal(engine.assetPaths.wasmPath, CONFIG.landmarker.wasmPath);
});

// ── Public API contract ─────────────────────────────────────────────────
test('index.js exports the documented public surface', () => {
  const expected = [
    'HachikoAI', 'FaceLandmarkerEngine', 'CONFIG', 'withOverrides',
    'AIState', 'StateReason', 'CalibrationStatus', 'PoseInvalidReason',
    'ScenarioTruth', 'EvidenceTier',
    'EvidenceEngine', 'EVIDENCE_SOURCES',
    'CalibrationEngine', 'FeatureSmoother', 'TemporalTracker',
    'PersistenceTimer', 'FaceMissingTracker', 'StateEngine',
    'HeadPoseExtractor', 'EyeFeatureExtractor',
    'normalizeAngleDeg', 'median', 'ema', 'eyeAspectRatio',
    'rotationMatrixToEuler', 'isFiniteNumber',
    'default',
  ];
  for (const name of expected) {
    assert.ok(name in PublicAPI, `index.js must export ${name}`);
  }
  assert.equal(PublicAPI.default, HachikoAI, 'default export is HachikoAI');
});

test('the public API leaks no tool internals', () => {
  assert.ok(!('TelemetryLogger' in PublicAPI), 'logger is a tool, not core API');
  assert.ok(!('DebugHarness' in PublicAPI), 'harness is a tool, not core API');
});
