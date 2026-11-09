import { defineNodeTestConfig } from '@repo/vitest-config';

// Nest decorators are legacy (experimentalDecorators) decorators. The admin scripts' tests run alongside src's.
export default defineNodeTestConfig({
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  test: { include: ['scripts/**/*.test.ts'] },
});
