import { defineNodeTestConfig } from '@repo/vitest-config';

export default defineNodeTestConfig({ oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } } });
