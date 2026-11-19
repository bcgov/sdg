import { RETURN_TO_PARAM } from '../contract.js';
import { SDG_ORIGIN } from './sdg-origin.js';

/** Per tab, on the other site's origin: the SDG page "Back to SDG" links to after the visitor moves around that site. */
export const RETURN_STORAGE_KEY = 'sdg-header:return-to';

type ReturnStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface ReturnSources {
  /** The SDG that served the header (`SDG_ORIGIN`). */
  sdgOrigin: string;
  /** The current page's URL. */
  pageUrl: string;
  /** `document.referrer`: SDG's origin when the visitor followed an SDG link without `return-to`. */
  referrer: string;
  /** The tab's session storage, or null where the browser refuses it. */
  storage: ReturnStorage | null;
}

// Not URL.canParse: the header runs on other sites' pages, for browsers older than it (Safari before 17).
function parseUrl(url: string, base?: string): URL | null {
  try {
    return new URL(url, base);
  } catch {
    return null; // Not a URL: treated as absent, like a missing parameter or referrer.
  }
}

function originOf(url: string): string | null {
  return parseUrl(url)?.origin ?? null;
}

// Only a path on SDG: one leading slash, never `//host` or `/\host` (which browsers read as another host), so a
// crafted `return-to` can only ever point back at the SDG that served the header.
function sdgPage(sdgOrigin: string, path: string | null): string | null {
  if (!path?.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null;
  const url = parseUrl(path, sdgOrigin);
  return url?.origin === sdgOrigin ? url.href : null;
}

function readStored(storage: ReturnStorage | null, sdgOrigin: string): string | null {
  const stored = storage?.getItem(RETURN_STORAGE_KEY) ?? null;
  return stored !== null && originOf(stored) === sdgOrigin ? stored : null;
}

/**
 * Where "Back to SDG" links, or null to hide it. On SDG itself, never. A visitor arriving from SDG (a `return-to`
 * path, else an SDG referrer, which gives SDG's home page) replaces what the tab remembers; otherwise the tab's
 * remembered page stays, so the link survives navigation within the other site.
 */
export function resolveReturnHref({ sdgOrigin, pageUrl, referrer, storage }: ReturnSources): string | null {
  if (!sdgOrigin || originOf(pageUrl) === sdgOrigin) return null;
  const fromParam = sdgPage(sdgOrigin, parseUrl(pageUrl)?.searchParams.get(RETURN_TO_PARAM) ?? null);
  const arrived = fromParam ?? (originOf(referrer) === sdgOrigin ? `${sdgOrigin}/` : null);
  if (arrived === null) return readStored(storage, sdgOrigin);
  storage?.setItem(RETURN_STORAGE_KEY, arrived);
  return arrived;
}

/** `resolveReturnHref` for this page. Storage the browser refuses (some private modes) limits the link to this page. */
export function backToSdgHref(): string | null {
  const sources = { sdgOrigin: SDG_ORIGIN, pageUrl: window.location.href, referrer: document.referrer };
  try {
    return resolveReturnHref({ ...sources, storage: window.sessionStorage });
  } catch (error) {
    console.warn('shared-ui: session storage is unavailable; Back to SDG shows on this page only', error);
    return resolveReturnHref({ ...sources, storage: null });
  }
}
