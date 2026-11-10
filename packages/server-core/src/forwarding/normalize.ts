/** A request target that is safe to classify and forward. */
export interface RequestTarget {
  /** The percent-decoded path, without the query string: what `classifyPath` reads. */
  readonly path: string;
  /** The path and query exactly as received: what is forwarded, so core-api decodes it the same way. */
  readonly target: string;
}

/** `%2f` and `%2e` in any case: an encoded slash or dot could change the path's meaning after one more decode. */
const ENCODED_SLASH_OR_DOT = /%2[ef]/i;

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
  const named = rawPath.length > 1 && rawPath.endsWith('/') ? segments.slice(0, -1) : segments;
  const decoded: string[] = [];
  for (const segment of named) {
    const value = decodeSegment(segment);
    if (value === undefined || value === '' || value === '.' || value === '..') return undefined;
    decoded.push(value);
  }
  return decoded;
}

/**
 * Checks an origin-form request target (Express `req.originalUrl`) for forwarding (KTD2). Returns undefined, which the
 * caller answers with 404, for anything whose decoded path could differ from what core-api sees: an encoded slash or
 * dot, a dot segment, an empty segment (a single trailing slash aside) or a malformed escape.
 */
export function normalizeRequestTarget(url: string): RequestTarget | undefined {
  if (!url.startsWith('/')) return undefined;
  const queryStart = url.indexOf('?');
  const rawPath = queryStart === -1 ? url : url.slice(0, queryStart);
  if (ENCODED_SLASH_OR_DOT.test(rawPath)) return undefined;
  const segments = decodeSegments(rawPath);
  if (segments === undefined) return undefined;
  const trailingSlash = rawPath.length > 1 && rawPath.endsWith('/') ? '/' : '';
  return { path: `/${segments.join('/')}${trailingSlash}`, target: url };
}
