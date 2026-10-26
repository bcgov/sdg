import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// Testing Library only auto-registers cleanup when Vitest globals are enabled.
afterEach(cleanup);

// jsdom has no portal-api: unless a test stubs fetch itself, every request answers 401 (signed out).
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ statusCode: 401, message: 'Unauthorized' }, { status: 401 })),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});
