import { defineReactTestConfig } from '@repo/vitest-config';

export default defineReactTestConfig({
  test: {
    name: 'portal-web',
    hookTimeout: 30_000,
    setupFiles: ['./src/test-setup.ts'],
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.(ts|tsx)'],
      exclude: ['src/main.tsx'],
      reportOnFailure: true,
    },
  },
});
