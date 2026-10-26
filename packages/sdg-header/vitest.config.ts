import { defineReactTestConfig } from '@repo/vitest-config';

// jsdom provides the DOM, custom elements and shadow roots Lit needs; nothing here is React.
export default defineReactTestConfig();
