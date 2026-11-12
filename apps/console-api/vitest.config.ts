import { defineNodeTestConfig } from '@repo/vitest-config';

// Nest decorators are legacy (experimentalDecorators) decorators.
export default defineNodeTestConfig({
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  test: {
    name: 'console-api',
    globals: true,
    environment: 'node',
    hookTimeout: 60_000,
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/migrate.ts', 'src/testing/*.ts'],
      reportOnFailure: true,
    },
  },
});
