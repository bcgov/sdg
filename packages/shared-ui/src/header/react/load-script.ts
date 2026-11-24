import { HEADER_PATHS, HEADER_TAG } from '../contract.js';

/**
 * The edge's `{ src, integrity }` for the environment's SRI-pinned loader, on the page's own origin (KTD11). It
 * resolves on every PR, TEST and PROD host with no per-environment config.
 */
export const DEFAULT_LOADER_CONFIG_URL: string = `/shared-ui/${HEADER_PATHS.loaderConfig}`;

interface LoaderConfig {
  src: string;
  integrity: string;
}

// SHA-384 is 48 bytes: exactly 64 base64 characters, no padding.
const SHA384_INTEGRITY = /^sha384-[A-Za-z0-9+/]{64}$/;

// One promise per config URL for the page's lifetime, so remounts, StrictMode double-mounts and several wrappers share
// one fetch and one <script>. A failure stays rejected rather than retrying: the page shows no header (R21) until it
// reloads.
const loads = new Map<string, Promise<void>>();

function isSameOriginPath(src: string): boolean {
  return src.startsWith('/') && new URL(src, location.origin).origin === location.origin;
}

function parseLoaderConfig(body: unknown, configUrl: string): LoaderConfig {
  const { src, integrity } = (typeof body === 'object' && body !== null ? body : {}) as Partial<LoaderConfig>;
  if (typeof integrity !== 'string' || !SHA384_INTEGRITY.test(integrity)) {
    throw new Error(`${configUrl}: integrity is not a sha384- hash`);
  }
  if (typeof src !== 'string' || !isSameOriginPath(src)) {
    throw new Error(`${configUrl}: src is not a same-origin path`);
  }
  return { src, integrity };
}

async function fetchLoaderConfig(configUrl: string): Promise<LoaderConfig> {
  const response = await fetch(configUrl, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${configUrl}: HTTP ${response.status}`);
  return parseLoaderConfig(await response.json(), configUrl);
}

function injectLoader({ src, integrity }: LoaderConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // Attributes rather than properties: equivalent in browsers, and jsdom does not reflect `integrity`.
    script.setAttribute('integrity', integrity);
    script.setAttribute('crossorigin', 'anonymous');
    script.src = src;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => {
        const error = new Error(`Failed to load the ${HEADER_TAG} loader from ${src}`);
        console.error('shared-ui: header loader failed to load; the page shows no header', { src, error });
        reject(error);
      },
      { once: true },
    );
    document.head.append(script);
  });
}

function hasScript(src: string): boolean {
  const resolved = new URL(src, document.baseURI).href;
  return Array.from(document.scripts).some((script) => script.src === resolved);
}

async function load(configUrl: string): Promise<void> {
  let config: LoaderConfig;
  try {
    config = await fetchLoaderConfig(configUrl);
  } catch (error) {
    console.error('shared-ui: header loader config unusable; the page shows no header', { configUrl, error });
    throw error;
  }
  if (hasScript(config.src)) {
    await customElements.whenDefined(HEADER_TAG);
    return;
  }
  return injectLoader(config);
}

/**
 * Loads the `<sdg-header>` through the SRI-pinned loader named by `configUrl`'s `{ src, integrity }`, unless the
 * element is already defined. Fetches and injects at most once per config URL, and injects nothing when the page
 * already has a tag for the loader (it then waits for the element to be defined).
 */
export function loadSdgHeader(configUrl: string = DEFAULT_LOADER_CONFIG_URL): Promise<void> {
  if (customElements.get(HEADER_TAG)) return Promise.resolve();
  let pending = loads.get(configUrl);
  if (!pending) {
    pending = load(configUrl);
    loads.set(configUrl, pending);
  }
  return pending;
}
