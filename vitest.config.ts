import { defineConfig } from 'vitest/config';

// Runs every workspace's tests in one process (IDE extension, `pnpm test:all`).
// Per-package `pnpm test` via turbo remains the cached path used by CI and hooks.
export default defineConfig({
  test: {
    projects: ['apps/*/vitest.config.ts', 'packages/*/vitest.config.ts', 'tooling/*/vitest.config.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
