import { afterEach, describe, expect, it, vi } from 'vitest';

// The origin is read when the module first evaluates, so each test imports a fresh copy.
async function freshSettingsHref(): Promise<string> {
  vi.resetModules();
  return (await import('./sdg-origin.js')).SETTINGS_HREF;
}

afterEach(() => {
  Reflect.deleteProperty(document, 'currentScript');
});

describe('SETTINGS_HREF', () => {
  it("links to /account-settings on the origin that served the header's script", async () => {
    const script = document.createElement('script');
    script.src = 'https://sdg-test.apps.example.gov.bc.ca/shared-ui/header/v1/sdg-header.js';
    Object.defineProperty(document, 'currentScript', { configurable: true, value: script });

    expect(await freshSettingsHref()).toBe('https://sdg-test.apps.example.gov.bc.ca/account-settings');
  });

  it("falls back to the page's origin when there is no current script (the module build)", async () => {
    expect(await freshSettingsHref()).toBe(`${window.location.origin}/account-settings`);
  });
});
