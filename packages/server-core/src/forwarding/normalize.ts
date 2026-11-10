/** A request target that is safe to classify and forward. */
export interface RequestTarget {
  /** The percent-decoded path, without the query string: what `classifyPath` reads. */
  readonly path: string;
  /** The path and query exactly as received: what is forwarded, so core-api decodes it the same way. */
  readonly target: string;
}

/** `%2f` and `%2e` in any case: an encoded slash or dot could change the path's meaning after one more decode. */
const ENCODED_SLASH_OR_DOT = /%2[ef]/i;
/**
 * A backslash, raw or as `%5c` in any case: fetch's URL parser reads a raw one as `/`, so `..\` would climb out of the
 * classified path (`/api/v1/portal/..\..\..\internal`), and an encoded one is a raw one after one more decode.
 */
const BACKSLASH = /\\|%5c/i;

function hasTrailingSlash(rawPath: string): boolean {
  return rawPath.length > 1 && rawPath.endsWith('/');
}

function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed escape: the target is rejected (404), so nothing is lost by not logging it.
    return undefined;
  }
}

/** Decoded segments, or undefined for a dot segment, an empty segment or a malformed escape. */
function decodeSegments(rawPath: string): string[] | undefined {
  // A single trailing slash is allowed: it leaves an empty last segment that names nothing.
  const segments = rawPath.slice(1).split('/');
  const named = hasTrailingSlash(rawPath) ? segments.slice(0, -1) : segments;
  const decoded: string[] = [];
  for (const segment of named) {
    const value = decodeSegment(segment);
    if (value === undefined || value === '' || value === '.' || value === '..') return undefined;
    decoded.push(value);
  }
  return decoded;
}

/**
 * Checks an origin-form request target (Express `req.originalUrl`) for forwarding. Returns undefined, which the
 * caller answers with 404, for anything whose decoded path could differ from what core-api sees: an encoded slash or
 * dot, a backslash (raw or encoded), a dot segment, an empty segment (a single trailing slash aside) or a malformed
 * escape. The query string is forwarded as is: the URL parser never reads it as path.
 */
export function normalizeRequestTarget(url: string): RequestTarget | undefined {
  if (!url.startsWith('/')) return undefined;
  const queryStart = url.indexOf('?');
  const rawPath = queryStart === -1 ? url : url.slice(0, queryStart);
  if (ENCODED_SLASH_OR_DOT.test(rawPath) || BACKSLASH.test(rawPath)) return undefined;
  const segments = decodeSegments(rawPath);
  if (segments === undefined) return undefined;
  const trailingSlash = hasTrailingSlash(rawPath) ? '/' : '';
  return { path: `/${segments.join('/')}${trailingSlash}`, target: url };
}
