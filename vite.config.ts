import { defineConfig } from 'vitest/config'

export default defineConfig({
  // `@ultralytics/yolo` is a wasm-bindgen package: its JS reaches for a
  // sibling `.wasm` with a RELATIVE url. Vite's dep optimizer rewrites the JS
  // into node_modules/.vite/deps/ but does not carry the wasm with it, so in
  // dev the fetch 404s and the HTML fallback reaches WebAssembly.instantiate
  // as "expected magic word ... found 3c 21 64 6f" (`<!do`). Excluding it
  // leaves the package served from its own directory, where the relative url
  // resolves. The production build already handles this correctly.
  optimizeDeps: {
    exclude: ['@ultralytics/yolo', '@litertjs/core', '@litertjs/wasm-utils'],
  },
  test: {
    // src/engine/ is the pure state machine (CLAUDE.md constraint 4).
    // src/ui/pacing.ts is also pure (no DOM) and unit-tested the same
    // way, even though it lives outside src/engine/ by design - it's
    // session-orchestration policy, not the core decision table.
    // src/storage/companion.ts is pure functions (no browser APIs) consuming
    // session data, also tested under Node.
    // src/perception/aiAdapter.ts is the pure AI-Engine -> Frame bridge, also
    // DOM-free, tested under Node.
    include: ['src/engine/**/*.test.ts', 'src/ui/**/*.test.ts', 'src/storage/**/*.test.ts', 'src/perception/**/*.test.ts'],
    environment: 'node',
  },
})
