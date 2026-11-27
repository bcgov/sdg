import { afterEach, describe, expect, it, vi } from 'vitest';

// The origin is read when the module first evaluates, so each test imports a fresh copy.
async function freshOrigin(): Promise<typeof import('./sdg-origin.js')> {
  vi.resetModules();
  return import('./sdg-origin.js');
}

async function freshSettingsHref(): Promise<string> {
  return (await freshOrigin()).SETTINGS_HREF;
}

function serveFrom(src: string): void {
  const script = document.createElement('script');
  script.src = src;
  Object.defineProperty(document, 'currentScript', { configurable: true, value: script });
}

afterEach(() => {
  Reflect.deleteProperty(document, 'currentScript');
});

describe('SETTINGS_HREF', () => {
  it("links to /settings on the origin that served the header's script", async () => {
    serveFrom('https://sdg-test.apps.example.gov.bc.ca/shared-ui/header/v1/sdg-header.js');

    expect(await freshSettingsHref()).toBe('https://sdg-test.apps.example.gov.bc.ca/settings');
  });

  it("falls back to the page's origin when there is no current script (the module build)", async () => {
    expect(await freshSettingsHref()).toBe(`${window.location.origin}/settings`);
  });
});

describe('HOME_HREF', () => {
  it("links to the home page of the origin that served the header's script", async () => {
    serveFrom('https://sdg-test.apps.example.gov.bc.ca/shared-ui/header/v1/bundles/sdg-header.abc123.js');

    expect((await freshOrigin()).HOME_HREF).toBe('https://sdg-test.apps.example.gov.bc.ca/');
  });

  it("falls back to the page's home page when there is no current script (the module build)", async () => {
    expect((await freshOrigin()).HOME_HREF).toBe(`${window.location.origin}/`);
  });
});
