/**
 * Copies MediaPipe WASM + the face landmarker model into public/assets/ so the
 * debug harness runs fully offline with no CDN dependency.
 *
 * The model is already vendored in the repo root (face_landmarker.task,
 * committed with the original Python research harness) — we reuse it rather
 * than re-downloading, and never modify or delete it.
 */
import { copyFile, mkdir, readdir, stat, access } from 'node:fs/promises';
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
console.log('[assets] done. Run: npm run dev');
