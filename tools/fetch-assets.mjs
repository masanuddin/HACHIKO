// Downloads the model and font files documented in public/models/README.md
// and public/fonts/README.md if they're not already present - a CI/deploy
// checkout never has them (they're gitignored, same as copy-wasm.mjs's
// source), and unlike a developer's machine, nothing prompts a human to
// run the README's curl commands by hand first. This is a build-time-only
// concern, same distinction the READMEs already document: the app itself
// makes zero network requests once built (CLAUDE.md constraint 2) - this
// script's downloads happen before that build exists.
import { existsSync, mkdirSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createWriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// Models are required: without them the camera screens fall back to a
// plain-language message instead of actually working (see
// public/models/README.md), which would make a live deploy silently
// non-functional. Fonts are cosmetic-only (the UI falls back to system
// fonts per public/fonts/README.md) and their upstream URLs are already
// documented as more likely to move - a failed font download should not
// fail the whole build.
const ASSETS = [
  {
    dest: join(root, 'public', 'models', 'face_landmarker.task'),
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    required: true,
  },
  {
    // Legacy: still fetched because the CURRENT (old) HACHIKO runtime
    // (src/perception/objects.ts) loads it. Retired once Phase 3 switches
    // the runtime to the AI-Engine ObjectDetectorEngine.
    dest: join(root, 'public', 'models', 'efficientdet_lite0.tflite'),
    url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite',
    required: true,
  },
  {
    // SELECTED production object-detector model for the AI integration
    // (EfficientDet-Lite2, float16). Decision is final; do not substitute
    // edl0_float16.tflite. Consumed by the AI runtime from Phase 3 onward;
    // fetched now so the asset exists ahead of the runtime switch.
    // URL = official Google/MediaPipe model host, verified against
    // AI-Engine tools/benchmark/candidates.js.
    dest: join(root, 'public', 'models', 'edl2_float16.tflite'),
    url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite',
    required: true,
  },
  {
    dest: join(root, 'public', 'models', 'blaze_face_short_range.tflite'),
    url: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
    required: true,
  },
  {
    dest: join(root, 'public', 'fonts', 'PlusJakartaSans-Variable.woff2'),
    url: 'https://github.com/tokotype/PlusJakartaSans/raw/master/fonts/webfonts/PlusJakartaSans%5Bwght%5D.woff2',
    required: false,
  },
  {
    dest: join(root, 'public', 'fonts', 'Inter-Variable.woff2'),
    url: 'https://github.com/rsms/inter/raw/master/docs/font-files/InterVariable.woff2',
    required: false,
  },
]

async function fetchOne({ dest, url, required }) {
  if (existsSync(dest)) {
    console.log(`[fetch-assets] ${dest} already present, skipping`)
    return
  }
  console.log(`[fetch-assets] downloading ${url}`)
  try {
    const res = await fetch(url)
    if (!res.ok || !res.body) {
      throw new Error(`${res.status} ${res.statusText}`)
    }
    mkdirSync(dirname(dest), { recursive: true })
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
    console.log(`[fetch-assets] wrote ${dest}`)
  } catch (err) {
    if (required) throw new Error(`[fetch-assets] failed to download required asset ${url}: ${err.message}`)
    console.warn(`[fetch-assets] failed to download optional asset ${url}: ${err.message} - continuing without it`)
  }
}

for (const asset of ASSETS) {
  await fetchOne(asset)
}
