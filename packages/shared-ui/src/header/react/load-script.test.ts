import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Loader = typeof import('./load-script.js');

// A fresh module per test: the loader keeps its promises at module level for the page's lifetime.
async function freshLoader(): Promise<Loader> {
  vi.resetModules();
  return import('./load-script.js');
}

function headerScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll('script'));
}

describe('loadSdgHeader', () => {
  beforeEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to the same-origin v1 path', async () => {
    const { DEFAULT_HEADER_SRC, loadSdgHeader } = await freshLoader();
    expect(DEFAULT_HEADER_SRC).toBe('/shared-ui/header/v1/sdg-header.js');

    void loadSdgHeader();
    expect(headerScripts().map((script) => script.getAttribute('src'))).toEqual(['/shared-ui/header/v1/sdg-header.js']);
  });

  it('loads from a given src', async () => {
    const { loadSdgHeader } = await freshLoader();
    void loadSdgHeader('https://portal.example/shared-ui/header/v1/sdg-header.js');
    expect(headerScripts().map((script) => script.src)).toEqual([
      'https://portal.example/shared-ui/header/v1/sdg-header.js',
    ]);
  });

  it('injects no script when sdg-header is already defined', async () => {
    const { loadSdgHeader } = await freshLoader();
    vi.spyOn(customElements, 'get').mockReturnValue(class extends HTMLElement {});

    await expect(loadSdgHeader()).resolves.toBeUndefined();
    expect(headerScripts()).toHaveLength(0);
  });

  it('injects one script for repeated calls and resolves them all on load', async () => {
    const { loadSdgHeader } = await freshLoader();
    const first = loadSdgHeader();
    const second = loadSdgHeader();

    expect(second).toBe(first);
    expect(headerScripts()).toHaveLength(1);
    headerScripts()[0]?.dispatchEvent(new Event('load'));
    await expect(first).resolves.toBeUndefined();
  });

  it('injects nothing when the page already has a tag for the src, and waits for the element', async () => {
    const { loadSdgHeader } = await freshLoader();
    const tag = document.createElement('script');
    tag.src = '/shared-ui/header/v1/sdg-header.js';
    document.head.append(tag);
    const whenDefined = vi.spyOn(customElements, 'whenDefined').mockResolvedValue(class extends HTMLElement {});

    await expect(loadSdgHeader()).resolves.toBeUndefined();
    expect(headerScripts()).toEqual([tag]);
    expect(whenDefined).toHaveBeenCalledWith('sdg-header');
  });

  it('rejects and logs once on a script error, without injecting again', async () => {
    const { loadSdgHeader } = await freshLoader();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = loadSdgHeader();

    headerScripts()[0]?.dispatchEvent(new Event('error'));
    await expect(load).rejects.toThrow('Failed to load the sdg-header script from /shared-ui/header/v1/sdg-header.js');
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      'shared-ui: header script failed to load; the page shows no header',
      expect.objectContaining({ src: '/shared-ui/header/v1/sdg-header.js' }),
    );

    await expect(loadSdgHeader()).rejects.toThrow('Failed to load the sdg-header script');
    expect(headerScripts()).toHaveLength(1);
  });
});
