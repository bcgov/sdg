import { defineNodeTestConfig } from '@repo/vitest-config';

// Nest decorators are legacy (experimentalDecorators) decorators.
export default defineNodeTestConfig({
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  test: {
    name: 'portal-api',
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/bootstrap.ts'],
      reportOnFailure: true,
    },
  },
});
