import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// The header script comes from the edge in the browser; here the element module defines <sdg-header> directly, so the
// SdgHeader wrapper finds it defined and injects no <script> (KTD13). Node-environment tests have no HTMLElement to
// extend, so they skip it.
if (typeof HTMLElement !== 'undefined') {
  const { defineSdgHeader } = await import('@repo/shared-ui/header');
  defineSdgHeader();
}

// Testing Library only auto-registers cleanup when Vitest globals are enabled.
afterEach(cleanup);

// jsdom has no matchMedia, which the header's nav reads to pick its layout: every query matches, so the header lays
// out wide (links inline, no menu button).
const matchAll = (media: string): MediaQueryList =>
  Object.assign(new EventTarget(), {
    matches: true,
    media,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
  });

// jsdom has no portal-api: unless a test stubs fetch itself, every request answers 401 (signed out).
beforeEach(() => {
  vi.stubGlobal('matchMedia', matchAll);
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
