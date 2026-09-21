/**
 * Copies MediaPipe WASM + the face landmarker model into public/assets/ so the
 * debug harness runs fully offline with no CDN dependency.
 *
 * The model is already vendored in the repo root (face_landmarker.task,
 * committed with the original Python research harness) — we reuse it rather
 * than re-downloading, and never modify or delete it.
 */
import { copyFile, mkdir, readdir, stat, access, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'assets');
const wasmOut = join(outDir, 'wasm');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const modelSrc = join(root, 'face_landmarker.task');
const modelOut = join(outDir, 'face_landmarker.task');

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

await mkdir(wasmOut, { recursive: true });

if (!(await exists(wasmSrc))) {
  console.error('[assets] node_modules/@mediapipe/tasks-vision/wasm missing. Run: npm install');
  process.exit(1);
}
let copied = 0;
for (const f of await readdir(wasmSrc)) {
  if (f.endsWith('.wasm') || f.endsWith('.js')) {
    await copyFile(join(wasmSrc, f), join(wasmOut, f));
    copied++;
  }
}
console.log(`[assets] copied ${copied} WASM runtime files -> public/assets/wasm/`);

if (await exists(modelSrc)) {
  await copyFile(modelSrc, modelOut);
  const { size } = await stat(modelOut);
  console.log(`[assets] copied face_landmarker.task (${(size / 1e6).toFixed(2)} MB) from repo root`);
} else {
  console.error('[assets] face_landmarker.task not found in repo root.');
  process.exit(1);
}

// Vendor the ESM bundle so index.html needs no bundler and no CDN.
const bundleSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'vision_bundle.mjs');
if (await exists(bundleSrc)) {
  await copyFile(bundleSrc, join(outDir, 'vision_bundle.mjs'));
  console.log('[assets] copied vision_bundle.mjs');
}

// ── YOLO26n browser runtime (benchmark page only) ────────────────────────
// Same rule as the MediaPipe bundle: vendor from node_modules so the page
// needs no bundler and no CDN, and the served bytes are the ones the
// lockfile pinned. The benchmark page declares an import map for
// `@litertjs/*`, because @litertjs/core imports `@litertjs/wasm-utils` as a
// BARE specifier that a browser cannot resolve on its own.
const YOLO_RUNTIME = [
  // dist/index.js imports "../pkg/...", so the vendored tree must keep the
  // package's own dist/ + pkg/ shape or that relative path escapes the folder.
  ['@ultralytics/yolo', 'dist/index.js', 'ultralytics-yolo/dist/index.js'],
  ['@litertjs/core', 'dist/index.js', 'litertjs/core.js'],
  ['@litertjs/wasm-utils', 'dist/index.js', 'litertjs/wasm-utils.js'],
];
let yoloCopied = 0;
for (const [pkg, from, to] of YOLO_RUNTIME) {
  const src = join(root, 'node_modules', ...pkg.split('/'), ...from.split('/'));
  if (!(await exists(src))) continue;
  const dest = join(outDir, ...to.split('/'));
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  yoloCopied += 1;
}
// The whole pkg/ tree, recursively: dist/index.js reaches into it for the
// wasm glue AND for pkg/snippets/, so copying only the top-level files
// leaves a module that imports a file that is not there.
async function copyTree(from, to) {
  if (!(await exists(from))) return 0;
  await mkdir(to, { recursive: true });
  let n = 0;
  for (const e of await readdir(from, { withFileTypes: true })) {
    n += e.isDirectory()
      ? await copyTree(join(from, e.name), join(to, e.name))
      : (await copyFile(join(from, e.name), join(to, e.name)), 1);
  }
  return n;
}
yoloCopied += await copyTree(
  join(root, 'node_modules', '@ultralytics', 'yolo', 'pkg'),
  join(outDir, 'ultralytics-yolo', 'pkg'));

// The wasm the LiteRT runtime loads at init, self-hosted so a
// cross-origin-isolated page is not blocked from fetching it off a CDN.
const litertWasmDir = join(root, 'node_modules', '@litertjs', 'core', 'wasm');
if (await exists(litertWasmDir)) {
  const wasmOut = join(outDir, 'litertjs', 'wasm');
  await mkdir(wasmOut, { recursive: true });
  for (const f of await readdir(litertWasmDir)) {
    await copyFile(join(litertWasmDir, f), join(wasmOut, f));
    yoloCopied += 1;
  }
}
console.log(yoloCopied
  ? `[assets] vendored ${yoloCopied} YOLO/LiteRT runtime files`
  : '[assets] YOLO/LiteRT runtime not installed — run npm install');
// v0.3: object detector model (person + cell phone). Fetched once and cached
// in public/assets so the harness still runs offline afterwards.
const OBJECT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite';
const objectOut = join(outDir, 'efficientdet_lite0.tflite');
if (await exists(objectOut)) {
  const { size } = await stat(objectOut);
  console.log(`[assets] efficientdet_lite0.tflite already present (${(size / 1e6).toFixed(2)} MB)`);
} else {
  console.log('[assets] downloading efficientdet_lite0.tflite (~4.6 MB, once)...');
  const res = await fetch(OBJECT_MODEL_URL);
  if (!res.ok) {
    console.error(`[assets] object model download failed: HTTP ${res.status}`);
    process.exit(1);
  }
  await writeFile(objectOut, Buffer.from(await res.arrayBuffer()));
  const { size } = await stat(objectOut);
  console.log(`[assets] saved efficientdet_lite0.tflite (${(size / 1e6).toFixed(2)} MB)`);
}

console.log('[assets] done. Run: npm run dev');
