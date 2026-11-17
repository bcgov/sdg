// The header's public contract: what implementers' markup and listeners depend on. No Preact import, so the React
// wrapper can use it without pulling Preact in. Renaming anything here is a breaking change, i.e. a new major (R14).

/**
 * The major version, served at `header/v<HEADER_MAJOR>/sdg-header.js`. It always serves the latest release in that
 * major; minor and patch releases carry no version in code.
 */
export const HEADER_MAJOR = 1;

export const HEADER_TAG = 'sdg-header';

export const HEADER_ATTRIBUTES = {
  siteTitle: 'site-title',
  userName: 'user-name',
  loginHref: 'login-href',
} as const;

export const HEADER_EVENTS = {
  login: 'sdg-login',
  logout: 'sdg-logout',
} as const;

export type HeaderAttributeName = (typeof HEADER_ATTRIBUTES)[keyof typeof HEADER_ATTRIBUTES];
export type HeaderEventName = (typeof HEADER_EVENTS)[keyof typeof HEADER_EVENTS];

/** The CDN bundle's path, relative to the shared-ui root (the build's output folder uses it too). */
export function headerCdnPath(): string {
  return `header/v${HEADER_MAJOR}/sdg-header.js`;
}
