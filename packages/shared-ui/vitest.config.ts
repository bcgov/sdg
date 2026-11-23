import { defineReactTestConfig } from '@repo/vitest-config';

// jsdom provides the DOM, custom elements and shadow roots the element needs. JSX is Preact, as in vite.config.ts.
// scripts/ holds Node CLI tests (the manifest signer); mergeConfig appends this to the shared src/** include.
export default defineReactTestConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  test: { include: ['scripts/**/*.test.ts'] },
});
