import { defineReactTestConfig } from '@repo/vitest-config';

// jsdom provides the DOM, custom elements and shadow roots the element needs. JSX is Preact, as in vite.config.ts.
export default defineReactTestConfig({ oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } } });
