import { defineReactTestConfig } from '@repo/vitest-config';

export default defineReactTestConfig({
  test: {
    name: 'console-web',
    hookTimeout: 30_000,
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.(ts|tsx)'],
      exclude: ['src/main.tsx'],
      reportOnFailure: true,
    },
  },
});
