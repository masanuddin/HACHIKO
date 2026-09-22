// Downloads the model and font files documented in public/models/README.md
// and public/fonts/README.md if they're not already present - a CI/deploy
// checkout never has them (they're gitignored, same as copy-wasm.mjs's
// source), and unlike a developer's machine, nothing prompts a human to
// run the README's curl commands by hand first. This is a build-time-only
// concern, same distinction the READMEs already document: the app itself
// makes zero network requests once built (CLAUDE.md constraint 2) - this
// script's downloads happen before that build exists.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
    // SUPERSEDED. EfficientDet-Lite2 was the provisional pick before
    // Perception DEVELOPMENT ran; 270 evaluable trials then selected
    // YOLO26n w8a32 (below) as one detector for Person AND Phone. Kept
    // only because the legacy runtime still references it; it is NOT the
    // production model any more.
    dest: join(root, 'public', 'models', 'edl2_float16.tflite'),
    url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite',
    required: true,
  },
  {
    // PRODUCTION object detector, frozen by Perception DEVELOPMENT.
    // One model serves Person (class 0) and Phone (class 67) in a single
    // inference, run through LiteRT.js.
    //
    // Integrity is CHECKED, not assumed: this is a GitHub release asset,
    // and a release asset can be replaced in place upstream. A mismatch
    // means the product would measure a model nobody benchmarked.
    dest: join(root, 'public', 'models', 'yolo26n_w8a32.tflite'),
    url: 'https://github.com/ultralytics/yolo-flutter-app/releases/download/'
       + 'v0.6.6/yolo26n_w8a32.tflite',
    required: true,
    sizeBytes: 2875553,
    sha256: 'd9cef07ce652ccfa9ce58e4ac8a4df98ff037739a9dad20a8afcae21b545df73',
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

/**
 * Verify a downloaded asset against its declared identity.
 *
 * Only what is declared is checked, so assets without an expected hash are
 * unaffected. Returns null when the file is good, or a reason when it is not.
 */
function integrityError(dest, { sizeBytes, sha256 }) {
  if (sizeBytes === undefined && sha256 === undefined) return null
  const buf = readFileSync(dest)
  if (sizeBytes !== undefined && buf.length !== sizeBytes) {
    return `size ${buf.length} != expected ${sizeBytes}`
  }
  if (sha256 !== undefined) {
    const actual = createHash('sha256').update(buf).digest('hex')
    if (actual !== sha256) return `sha256 ${actual} != expected ${sha256}`
  }
  return null
}

async function fetchOne({ dest, url, required, sizeBytes, sha256 }) {
  if (existsSync(dest)) {
    // A cached file is not trusted on sight: a truncated download and an
    // upstream replacement both leave a file that exists.
    const bad = integrityError(dest, { sizeBytes, sha256 })
    if (!bad) {
      console.log(`[fetch-assets] ${dest} already present, skipping`)
      return
    }
    console.warn(`[fetch-assets] cached ${dest} REJECTED - ${bad}; re-fetching`)
    rmSync(dest, { force: true })
  }
  console.log(`[fetch-assets] downloading ${url}`)
  try {
    const res = await fetch(url)
    if (!res.ok || !res.body) {
      throw new Error(`${res.status} ${res.statusText}`)
    }
    mkdirSync(dirname(dest), { recursive: true })
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
    const bad = integrityError(dest, { sizeBytes, sha256 })
    if (bad) {
      // Delete rather than keep: a later run must not mistake it for cache.
      rmSync(dest, { force: true })
      throw new Error(`integrity check failed - ${bad}`)
    }
    console.log(`[fetch-assets] wrote ${dest}`
      + (sha256 ? ' (verified size + sha256)' : ''))
  } catch (err) {
    if (required) throw new Error(`[fetch-assets] failed to download required asset ${url}: ${err.message}`)
    console.warn(`[fetch-assets] failed to download optional asset ${url}: ${err.message} - continuing without it`)
  }
}

for (const asset of ASSETS) {
  await fetchOne(asset)
}
