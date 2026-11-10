import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// Testing Library only auto-registers cleanup when Vitest globals are enabled.
afterEach(cleanup);

// jsdom has no admin-api: unless a test stubs fetch itself, every request answers 401 (signed out).
beforeEach(() => {
  // The router's scroll restoration calls scrollTo, which jsdom doesn't implement.
  vi.stubGlobal('scrollTo', vi.fn<typeof window.scrollTo>());
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

// Devtools render only in dev; keep them out of jsdom.
vi.mock('./components/devtools', () => ({ Devtools: () => null }));
