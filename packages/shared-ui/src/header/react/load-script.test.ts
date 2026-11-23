import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Loader = typeof import('./load-script.js');

const INTEGRITY = `sha384-${'A'.repeat(64)}`;
const CONFIG = { src: '/shared-ui/header/v1/loader.js', integrity: INTEGRITY };

// A fresh module per test: the loader keeps its promises at module level for the page's lifetime.
async function freshLoader(): Promise<Loader> {
  vi.resetModules();
  return import('./load-script.js');
}

function headerScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll('script'));
}

function stubFetch(response: () => Response): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// The loader resolves loader.json before injecting, so tests wait for the injected tag (or the rejection).
async function injected(): Promise<HTMLScriptElement> {
  await vi.waitFor(() => expect(headerScripts()).toHaveLength(1));
  const [script] = headerScripts();
  if (!script) throw new Error('no script injected');
  return script;
}

describe('loadSdgHeader', () => {
  beforeEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches the same-origin loader.json uncached and injects the loader with its integrity', async () => {
    const fetchMock = stubFetch(() => json(CONFIG));
    const { DEFAULT_LOADER_CONFIG_URL, loadSdgHeader } = await freshLoader();
    expect(DEFAULT_LOADER_CONFIG_URL).toBe('/shared-ui/header/v1/loader.json');

    void loadSdgHeader();
    const script = await injected();

    expect(fetchMock).toHaveBeenCalledWith('/shared-ui/header/v1/loader.json', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    expect(script.getAttribute('src')).toBe('/shared-ui/header/v1/loader.js');
    expect(script.getAttribute('integrity')).toBe(INTEGRITY);
    expect(script.getAttribute('crossorigin')).toBe('anonymous');
  });

  it('fetches a given config URL', async () => {
    const fetchMock = stubFetch(() => json(CONFIG));
    const { loadSdgHeader } = await freshLoader();

    void loadSdgHeader('/elsewhere/loader.json');
    await injected();
    expect(fetchMock).toHaveBeenCalledWith('/elsewhere/loader.json', expect.anything());
  });

  it('fetches and injects nothing when sdg-header is already defined', async () => {
    const fetchMock = stubFetch(() => json(CONFIG));
    const { loadSdgHeader } = await freshLoader();
    vi.spyOn(customElements, 'get').mockReturnValue(class extends HTMLElement {});

    await expect(loadSdgHeader()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(headerScripts()).toHaveLength(0);
  });

  it('fetches once and injects one script for repeated calls, and resolves them all on load', async () => {
    const fetchMock = stubFetch(() => json(CONFIG));
    const { loadSdgHeader } = await freshLoader();
    const first = loadSdgHeader();
    const second = loadSdgHeader();

    expect(second).toBe(first);
    const script = await injected();
    script.dispatchEvent(new Event('load'));
    await expect(first).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('injects nothing when the page already has a tag for the loader, and waits for the element', async () => {
    stubFetch(() => json(CONFIG));
    const { loadSdgHeader } = await freshLoader();
    const tag = document.createElement('script');
    tag.src = CONFIG.src;
    document.head.append(tag);
    const whenDefined = vi.spyOn(customElements, 'whenDefined').mockResolvedValue(class extends HTMLElement {});

    await expect(loadSdgHeader()).resolves.toBeUndefined();
    expect(headerScripts()).toEqual([tag]);
    expect(whenDefined).toHaveBeenCalledWith('sdg-header');
  });

  it('logs shared-ui: and injects nothing when loader.json is a 404', async () => {
    stubFetch(() => new Response('Not Found', { status: 404 }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { loadSdgHeader } = await freshLoader();

    await expect(loadSdgHeader()).rejects.toThrow('HTTP 404');
    expect(headerScripts()).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringMatching(/^shared-ui: /),
      expect.objectContaining({ configUrl: '/shared-ui/header/v1/loader.json' }),
    );
  });

  it.each([
    ['a sha256 integrity', { ...CONFIG, integrity: `sha256-${'A'.repeat(43)}=` }],
    ['a sha384 integrity of the wrong length', { ...CONFIG, integrity: `sha384-${'A'.repeat(40)}` }],
    ['a missing integrity', { src: CONFIG.src }],
    ['a cross-origin src', { ...CONFIG, src: 'https://attacker.example/loader.js' }],
    ['a protocol-relative src', { ...CONFIG, src: '//attacker.example/loader.js' }],
  ])('refuses %s, logging shared-ui: and injecting nothing', async (_name, body) => {
    stubFetch(() => json(body));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { loadSdgHeader } = await freshLoader();

    await expect(loadSdgHeader()).rejects.toThrow(/loader\.json/);
    expect(headerScripts()).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/^shared-ui: /), expect.anything());
  });

  it('rejects and logs once on a loader script error, without injecting again', async () => {
    stubFetch(() => json(CONFIG));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { loadSdgHeader } = await freshLoader();
    const load = loadSdgHeader();

    (await injected()).dispatchEvent(new Event('error'));
    await expect(load).rejects.toThrow('Failed to load the sdg-header loader from /shared-ui/header/v1/loader.js');
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      'shared-ui: header loader failed to load; the page shows no header',
      expect.objectContaining({ src: '/shared-ui/header/v1/loader.js' }),
    );

    await expect(loadSdgHeader()).rejects.toThrow('Failed to load the sdg-header loader');
    expect(headerScripts()).toHaveLength(1);
  });
});
