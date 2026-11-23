// The header loader (R4, R8–R12, KTD2, KTD4, KTD14): fetches the signed release manifest from the loader's own origin,
// verifies it, enforces expiry and the higher of the remembered and manifest floors, then injects the release's bundle
// with the manifest's hash as its `integrity`. It holds no header code. Any failure means no header, logged.
import { HEADER_TAG } from '../header/contract.ts';
import type { ManifestPayload } from '../signing/manifest.ts';
import { verifyManifest, type TrustedKeys } from '../signing/verify.ts';
import { floorKey, readFloor, rememberFloor, type StorageProvider } from './floor-store.ts';

export interface LoaderConfig {
  /** The keyset this loader serves (`pr`, `test`, `prod`, `dev`). */
  keyset: string;
  /** The keyset's primary and backup public keys (R7). */
  keys: TrustedKeys;
  /** The header major this loader belongs to. */
  major: number;
}

export interface LoaderDeps {
  /** The page's document; its `currentScript` must still be the loader when `loadHeader` is called. */
  document: Document;
  fetch: typeof fetch;
  storage: StorageProvider;
  /** Current time, ms since the epoch. */
  now: () => number;
}

/** How a run ended: the element was already there, a verified bundle loaded, or the page shows no header (R12). */
export type LoaderOutcome = 'already-defined' | 'loaded' | 'no-header';

interface Context {
  config: LoaderConfig;
  deps: LoaderDeps;
  origin: string;
  manifestUrl: string;
}

/** The origin of the loader's own `<script src>`. Read synchronously: `currentScript` is null after the first await. */
function loaderOrigin(document: Document): string | undefined {
  const script = document.currentScript;
  if (!script || !('src' in script) || typeof script.src !== 'string' || script.src === '') return undefined;
  return new URL(script.src).origin;
}

/** The parsed manifest JSON, or `undefined` (logged) when it can't be fetched or parsed. */
async function fetchManifest(context: Context): Promise<{ value: unknown } | undefined> {
  const url = context.manifestUrl;
  try {
    const response = await context.deps.fetch(url, { credentials: 'omit', cache: 'no-cache' });
    if (!response.ok) {
      console.error('shared-ui: header manifest request failed; the page shows no header', {
        url,
        status: response.status,
      });
      return undefined;
    }
    return { value: await response.json() };
  } catch (error) {
    console.error('shared-ui: cannot fetch the header manifest; the page shows no header', { url, error });
    return undefined;
  }
}

/** Fetches and verifies the manifest, and remembers its floor when higher. `undefined` (logged) when refused. */
async function fetchRelease(context: Context): Promise<ManifestPayload | undefined> {
  const { config, deps } = context;
  const key = floorKey(config.keyset, config.major);
  const stored = readFloor(deps.storage, key);
  const manifest = await fetchManifest(context);
  if (!manifest) return undefined;
  const result = await verifyManifest(manifest.value, {
    keys: config.keys,
    keyset: config.keyset,
    now: deps.now(),
    floor: stored ?? 0,
  });
  if (!result.ok) {
    console.error('shared-ui: header manifest refused; the page shows no header', {
      url: context.manifestUrl,
      reason: result.reason,
    });
    return undefined;
  }
  if (stored === undefined || result.payload.floor > stored) rememberFloor(deps.storage, key, result.payload.floor);
  return result.payload;
}

/** Injects the release's bundle; resolves `true` on `load` and `false` (logged) on `error`. */
function injectBundle(context: Context, release: ManifestPayload): Promise<boolean> {
  const { document } = context.deps;
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = new URL(release.bundle.path, context.origin).href;
    script.integrity = release.bundle.integrity;
    script.crossOrigin = 'anonymous';
    script.addEventListener('load', () => resolve(true), { once: true });
    script.addEventListener(
      'error',
      () => {
        console.warn('shared-ui: header bundle failed to load', { src: script.src, version: release.version });
        resolve(false);
      },
      { once: true },
    );
    document.head.append(script);
  });
}

/**
 * Fetches, verifies and injects one release: `true` when its bundle loaded, `false` after a bundle error, and
 * `'refused'` when no release passed the checks.
 */
async function attempt(context: Context): Promise<boolean | 'refused'> {
  const release = await fetchRelease(context);
  return release ? injectBundle(context, release) : 'refused';
}

/** One attempt, and after a failed bundle load one more with a refetched manifest (KTD14). */
async function run(context: Context): Promise<LoaderOutcome> {
  const first = await attempt(context);
  if (first === true) return 'loaded';
  if (first === 'refused') return 'no-header';
  const retry = await attempt(context);
  if (retry === true) return 'loaded';
  if (retry === 'refused') return 'no-header';
  console.error('shared-ui: header bundle failed to load after a retry; the page shows no header', {
    url: context.manifestUrl,
  });
  return 'no-header';
}

/**
 * Loads the verified header release unless `<sdg-header>` is already defined. Call it synchronously from the loader
 * script, while `document.currentScript` is the loader. Never rejects: every failure is logged and means no header.
 */
export async function loadHeader(config: LoaderConfig, deps: LoaderDeps): Promise<LoaderOutcome> {
  const registry = deps.document.defaultView?.customElements ?? globalThis.customElements;
  if (registry?.get(HEADER_TAG)) return 'already-defined';
  const origin = loaderOrigin(deps.document);
  if (!origin) {
    console.error('shared-ui: the header loader cannot find its own script src; the page shows no header');
    return 'no-header';
  }
  const manifestUrl = new URL(`/shared-ui/header/v${config.major}/manifest.json`, origin).href;
  try {
    return await run({ config, deps, origin, manifestUrl });
  } catch (error) {
    console.error('shared-ui: the header loader failed; the page shows no header', { url: manifestUrl, error });
    return 'no-header';
  }
}
