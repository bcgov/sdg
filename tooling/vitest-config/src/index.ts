import { defineConfig, mergeConfig, type ViteUserConfig } from 'vitest/config';

const shared: ViteUserConfig = defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/*.d.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});

/** Vitest config for Node code (libraries, NestJS apps, tooling). */
export function defineNodeTestConfig(overrides: ViteUserConfig = {}): ViteUserConfig {
  return mergeConfig(mergeConfig(shared, { test: { environment: 'node' } }), overrides);
}

/** Vitest config for React code. Requires `jsdom` in the consuming package. */
export function defineReactTestConfig(overrides: ViteUserConfig = {}): ViteUserConfig {
  return mergeConfig(mergeConfig(shared, { test: { environment: 'jsdom' } }), overrides);
}
