import { defineConfig } from 'vitest/config'

export default defineConfig({
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
