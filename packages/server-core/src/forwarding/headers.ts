/** Incoming request headers, as Node (`IncomingHttpHeaders`) or Express presents them. */
export type IncomingHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

/** The only request headers forwarded (KTD3): content negotiation, the body's type, trace context and request id. */
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'traceparent',
  'tracestate',
  'x-request-id',
] as const;

/** Hop-by-hop headers (RFC 9110 §7.6.1), never relayed. */
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

/**
 * Dropped from relayed responses: `set-cookie`, so core-api can never set a cookie on the caller's origin, and the
 * body's encoding and length, which no longer apply because fetch decodes the body.
 */
const NOT_RELAYED = ['set-cookie', 'content-encoding', 'content-length'];

/** The allow-listed headers of the incoming request plus `Authorization: Bearer <token>`. */
export function forwardedRequestHeaders(incoming: IncomingHeaders, token: string): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming[name];
    if (typeof value === 'string') headers.set(name, value);
    else if (value !== undefined) headers.set(name, value.join(', '));
  }
  headers.set('authorization', `Bearer ${token}`);
  return headers;
}

/** core-api's response headers minus hop-by-hop headers (including any the Connection header names) and NOT_RELAYED. */
export function relayedResponseHeaders(upstream: Headers): Headers {
  const named = (upstream.get('connection') ?? '').split(',').map((name) => name.trim().toLowerCase());
  const dropped = new Set([...HOP_BY_HOP, ...NOT_RELAYED, ...named]);
  const headers = new Headers();
  for (const [name, value] of upstream) {
    if (!dropped.has(name)) headers.append(name, value);
  }
  return headers;
}
