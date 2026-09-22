// Copies the MediaPipe tasks-vision WASM bundle out of node_modules into
// public/wasm/ so the app can load it from same-origin at runtime instead of
// a CDN (CLAUDE.md constraint 2: no network calls, ever). This only touches
// the local filesystem - no network access required beyond `npm install`
// having already fetched the package.
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const dest = join(root, 'public', 'wasm')

if (!existsSync(src)) {
  console.warn(
    `[copy-wasm] ${src} not found - run "npm install" first. ` +
      'Skipping (this is expected before the first install).',
  )
  process.exit(0)
}

mkdirSync(dest, { recursive: true })

let copied = 0
for (const name of readdirSync(src)) {
  const from = join(src, name)
  if (statSync(from).isFile()) {
    copyFileSync(from, join(dest, name))
    copied += 1
  }
}

console.log(`[copy-wasm] copied ${copied} file(s) into public/wasm/`)

// LiteRT.js wasm for the frozen YOLO26n detector. Same rule as above: the
// runtime would otherwise fetch its worker from a CDN, which breaks the
// no-network constraint and is blocked outright on a cross-origin-isolated
// page. Copied into public/wasm/litertjs/ and served same-origin.
const litertSrc = join(root, 'node_modules', '@litertjs', 'core', 'wasm')
const litertDest = join(dest, 'litertjs')

if (!existsSync(litertSrc)) {
  console.warn(
    `[copy-wasm] ${litertSrc} not found - run "npm install" first. ` +
      'The YOLO detector will not load without it.',
  )
} else {
  mkdirSync(litertDest, { recursive: true })
  let litertCopied = 0
  for (const name of readdirSync(litertSrc)) {
    const from = join(litertSrc, name)
    if (statSync(from).isFile()) {
      copyFileSync(from, join(litertDest, name))
      litertCopied += 1
    }
  }
  console.log(`[copy-wasm] copied ${litertCopied} LiteRT file(s) into public/wasm/litertjs/`)
}

// The LiteRT.js ES modules themselves. `@ultralytics/yolo` loads its .tflite
// backend with `await import("@litertjs/core")` behind a @vite-ignore, so the
// specifier survives bundling and the BROWSER has to resolve it. Bare
// specifiers are not resolvable in a browser, so index.html declares an
// import map pointing at these vendored copies - same origin, same versions
// npm installed, and identical in dev and in the production build.
for (const [pkg, out] of [
  ['@litertjs/core', 'core.js'],
  ['@litertjs/wasm-utils', 'wasm-utils.js'],
]) {
  const from = join(root, 'node_modules', ...pkg.split('/'), 'dist', 'index.js')
  if (!existsSync(from)) {
    console.warn(`[copy-wasm] ${from} not found - the YOLO detector will not load.`)
    continue
  }
  const to = join(root, 'public', 'vendor', 'litertjs', out)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  console.log(`[copy-wasm] vendored ${pkg} -> public/vendor/litertjs/${out}`)
}
