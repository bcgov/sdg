// The header's public contract: what implementers' markup and listeners depend on. No Preact import, so the React
// wrapper can use it without pulling Preact in. Renaming anything here is a breaking change, i.e. a new major (R14).

/**
 * The major version, in every path under `header/v<HEADER_MAJOR>/`. Within a major the loader's URL and bytes never
 * change (R1); releases reach visitors through the signed manifest, and carry no version in code.
 */
export const HEADER_MAJOR = 1;

export const HEADER_TAG = 'sdg-header';

export const HEADER_ATTRIBUTES = {
  siteTitle: 'site-title',
  userName: 'user-name',
  loginHref: 'login-href',
  /** Boolean: present means the rows' contents span the full width instead of the responsive max-width container. */
  fluid: 'fluid',
} as const;

export const HEADER_EVENTS = {
  login: 'sdg-login',
  logout: 'sdg-logout',
  settings: 'sdg-settings',
} as const;

/**
 * The query parameter SDG adds to its links to other sites: the SDG page (a path, with its search and hash) the
 * visitor left from. The header on the other site reads it and links "Back to SDG" there.
 */
export const RETURN_TO_PARAM = 'return-to';

/** `href` (an absolute URL on another site) with `return-to` set to `returnPath`, a path on SDG. */
export function withReturnTo(href: string, returnPath: string): string {
  const url = new URL(href);
  url.searchParams.set(RETURN_TO_PARAM, returnPath);
  return url.href;
}

export type HeaderAttributeName = (typeof HEADER_ATTRIBUTES)[keyof typeof HEADER_ATTRIBUTES];
export type HeaderEventName = (typeof HEADER_EVENTS)[keyof typeof HEADER_EVENTS];

/** The served paths of this major, relative to the shared-ui root (the edge serves that root at `/shared-ui/`). */
export const HEADER_PATHS: Readonly<Record<'loader' | 'manifest' | 'loaderConfig' | 'bundles', string>> = {
  /** The SRI-pinned loader for the environment's keyset (KTD5): the one script sites embed. */
  loader: `header/v${HEADER_MAJOR}/loader.js`,
  /** The signed release manifest the loader fetches (KTD2, KTD6). */
  manifest: `header/v${HEADER_MAJOR}/manifest.json`,
  /** `{ src, integrity }` of the loader, for in-repo apps (KTD11). */
  loaderConfig: `header/v${HEADER_MAJOR}/loader.json`,
  /** Folder of the immutable, content-hashed release bundles (KTD2). */
  bundles: `header/v${HEADER_MAJOR}/bundles/`,
};

/**
 * @deprecated The unsigned always-latest URL, no longer built or served (KTD12). Kept only for the README test until it
 * moves to the loader (U9); do not use.
 */
export function headerCdnPath(): string {
  return `header/v${HEADER_MAJOR}/sdg-header.js`;
}
