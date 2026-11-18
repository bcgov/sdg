import { HEADER_TAG, headerCdnPath } from '../contract.js';

/**
 * The header script on the page's own origin (KTD11). It resolves on every PR, TEST and PROD portal host with no
 * per-environment config; hosts elsewhere pass the portal host's absolute URL instead.
 */
export const DEFAULT_HEADER_SRC: string = `/shared-ui/${headerCdnPath()}`;

// One promise per src for the page's lifetime, so remounts, StrictMode double-mounts and several wrappers share one
// <script>. A failed load stays rejected rather than retrying: the page shows no header (R21) until it reloads.
const loads = new Map<string, Promise<void>>();

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => {
        const error = new Error(`Failed to load the ${HEADER_TAG} script from ${src}`);
        console.error('shared-ui: header script failed to load; the page shows no header', { src, error });
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

/**
 * Loads the `<sdg-header>` script unless the element is already defined. Injects at most one `<script>` per src, and
 * none when the page already has a tag for it (it then waits for the element to be defined).
 */
export function loadSdgHeader(src: string = DEFAULT_HEADER_SRC): Promise<void> {
  if (customElements.get(HEADER_TAG)) return Promise.resolve();
  let load = loads.get(src);
  if (!load) {
    load = hasScript(src) ? customElements.whenDefined(HEADER_TAG).then(() => undefined) : injectScript(src);
    loads.set(src, load);
  }
  return load;
}
