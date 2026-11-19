import { afterEach, describe, expect, it, vi } from 'vitest';

import { RETURN_STORAGE_KEY, resolveReturnHref, type ReturnSources } from './back-to-sdg.js';

const SDG = 'https://sdg.gov.bc.ca';
const PARTNER = 'https://partner.gov.bc.ca';

function memoryStorage(initial?: string): Pick<Storage, 'getItem' | 'setItem'> & { value: string | null } {
  const store = {
    value: initial ?? null,
    getItem: () => store.value,
    setItem: (_key: string, value: string) => {
      store.value = value;
    },
  };
  return store;
}

function resolve(sources: Partial<ReturnSources>): string | null {
  return resolveReturnHref({ sdgOrigin: SDG, pageUrl: `${PARTNER}/`, referrer: '', storage: null, ...sources });
}

describe('resolveReturnHref', () => {
  it('links to the SDG page named by return-to, and remembers it for the tab', () => {
    const storage = memoryStorage();
    const href = resolve({ pageUrl: `${PARTNER}/apply?return-to=%2Fservices%3Fq%3Dlicence`, storage });
    expect(href).toBe(`${SDG}/services?q=licence`);
    expect(storage.value).toBe(`${SDG}/services?q=licence`);
  });

  it('keeps the remembered page on later pages of the other site', () => {
    expect(resolve({ pageUrl: `${PARTNER}/apply/step-2`, storage: memoryStorage(`${SDG}/services`) })).toBe(
      `${SDG}/services`,
    );
  });

  it("falls back to SDG's home page for an SDG referrer without return-to, replacing the remembered page", () => {
    const storage = memoryStorage(`${SDG}/services`);
    expect(resolve({ referrer: `${SDG}/`, storage })).toBe(`${SDG}/`);
    expect(storage.value).toBe(`${SDG}/`);
  });

  it('prefers return-to over the referrer', () => {
    expect(resolve({ pageUrl: `${PARTNER}/?return-to=%2Fhelp`, referrer: `${SDG}/` })).toBe(`${SDG}/help`);
  });

  it('shows nothing for a visitor who did not come from SDG', () => {
    expect(resolve({ referrer: 'https://www.example.com/', storage: memoryStorage() })).toBeNull();
  });

  it('never shows on SDG itself', () => {
    expect(resolve({ pageUrl: `${SDG}/services?return-to=%2Fhelp`, storage: memoryStorage(`${SDG}/`) })).toBeNull();
  });

  it.each([
    ['another host', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example/'],
    ['a backslash host', '/\\evil.example/'],
    ['a relative path', 'services'],
    ['a script URL', 'javascript:alert(1)'],
  ])('ignores a return-to that is %s', (_case, value) => {
    const pageUrl = `${PARTNER}/?return-to=${encodeURIComponent(value)}`;
    expect(resolve({ pageUrl, storage: memoryStorage() })).toBeNull();
  });

  it('ignores a remembered page on another origin', () => {
    expect(resolve({ storage: memoryStorage('https://evil.example/') })).toBeNull();
  });

  it('still links from the arrival page when there is no storage', () => {
    expect(resolve({ pageUrl: `${PARTNER}/?return-to=%2F` })).toBe(`${SDG}/`);
  });
});

// The header's origin is read when sdg-origin.ts first evaluates, so each test loads a fresh copy as if a partner
// page (jsdom's own origin) had loaded the script from SDG.
async function freshBackToSdgHref(): Promise<() => string | null> {
  vi.resetModules();
  const script = document.createElement('script');
  script.src = `${SDG}/shared-ui/header/v1/sdg-header.js`;
  Object.defineProperty(document, 'currentScript', { configurable: true, value: script });
  return (await import('./back-to-sdg.js')).backToSdgHref;
}

describe('backToSdgHref', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'currentScript');
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it("reads return-to from the page's URL and remembers it in the tab's session storage", async () => {
    const backToSdg = await freshBackToSdgHref();
    window.history.replaceState(null, '', '/apply?return-to=%2Fservices');
    expect(backToSdg()).toBe(`${SDG}/services`);

    window.history.replaceState(null, '', '/apply/step-2');
    expect(backToSdg()).toBe(`${SDG}/services`);
    expect(window.sessionStorage.getItem(RETURN_STORAGE_KEY)).toBe(`${SDG}/services`);
  });

  it('shows nothing on the page that served the header (the module build on SDG itself)', async () => {
    vi.resetModules();
    window.history.replaceState(null, '', '/?return-to=%2Fservices');
    const { backToSdgHref: onSdg } = await import('./back-to-sdg.js');
    expect(onSdg()).toBeNull();
  });

  it('warns and links from this page only when the browser refuses session storage', async () => {
    const backToSdg = await freshBackToSdgHref();
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.history.replaceState(null, '', '/?return-to=%2Fhelp');

    expect(backToSdg()).toBe(`${SDG}/help`);
    expect(warn).toHaveBeenCalledWith(
      'shared-ui: session storage is unavailable; Back to SDG shows on this page only',
      expect.any(DOMException),
    );
  });
});
