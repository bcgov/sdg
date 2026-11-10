/**
 * The route contract shared by core-api and its forwarders (KTD2). core-api mounts each audience's controllers under
 * `/api/v<N>/<audience>/…`, so forwarders pass paths through unchanged. Everything else stays local to a service:
 * `/api/auth/*` and `/healthz/*` in each, `/internal/*` (core-api's BFF-only routes) never forwarded.
 */
export const AUDIENCES = ['portal', 'admin', 'gateway', 'shared'] as const;
export type Audience = (typeof AUDIENCES)[number];

const FORWARDED_PATH = new RegExp(`^/api/v[1-9]\\d*/(${AUDIENCES.join('|')})(?:/|$)`);

function isAudience(value: string | undefined): value is Audience {
  return AUDIENCES.some((audience) => audience === value);
}

/** The audience of a normalized, percent-decoded path (`normalizeRequestTarget`), or undefined if not forwardable. */
export function classifyPath(path: string): Audience | undefined {
  const audience = FORWARDED_PATH.exec(path)?.[1];
  return isAudience(audience) ? audience : undefined;
}
