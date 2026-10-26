import { defineReactTestConfig } from '@repo/vitest-config';

export default defineReactTestConfig({
  test: { setupFiles: ['./src/test-setup.ts'] },
});
