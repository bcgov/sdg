import '@fortawesome/fontawesome-svg-core/styles.css';
import '@testing-library/jest-dom/vitest';
import { config as fontAwesomeConfig } from '@fortawesome/fontawesome-svg-core';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { stubViewport } from './test-support/match-media';

// As in main.tsx: FontAwesome's <style> injection is off, so tests see the same document head as the edge CSP allows.
fontAwesomeConfig.autoAddCss = false;

// Testing Library only auto-registers cleanup when Vitest globals are enabled.
afterEach(cleanup);

// jsdom has no console-api: unless a test stubs fetch itself, every request answers 401 (signed out).
beforeEach(() => {
  // The router's scroll restoration calls scrollTo, which jsdom doesn't implement.
  vi.stubGlobal('scrollTo', vi.fn<typeof window.scrollTo>());
  // jsdom has no matchMedia: every test starts on a wide screen unless it stubs a narrow one.
  stubViewport(false);
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
