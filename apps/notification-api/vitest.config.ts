import { defineNodeTestConfig } from '@repo/vitest-config';

// Nest decorators are legacy (experimentalDecorators) decorators.
export default defineNodeTestConfig({ oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } } });
