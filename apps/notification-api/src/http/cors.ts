import type { CorsOptions, CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import type { Request } from 'express';

/** The recipient endpoints, the only paths direct mode opens to other origins (KTD7). */
const RECIPIENT_PATH_PREFIX = '/api/v1/me/';

/** How long a browser may cache a preflight answer. */
const PREFLIGHT_MAX_AGE_SECONDS = 600;

/**
 * CORS for direct mode (KTD7): pages on `allowedOrigins` may call `/api/v1/me/*` with a bearer token. Other origins
 * get no `access-control-allow-origin`, other paths get no CORS headers at all, and credentials (cookies) are never
 * allowed. helmet's `cross-origin-resource-policy: same-origin` applies only to no-cors requests, so it does not block
 * these CORS reads.
 */
export function recipientCors(allowedOrigins: readonly string[]): CorsOptionsDelegate<Request> {
  const recipient: CorsOptions = {
    origin: [...allowedOrigins],
    methods: ['GET', 'POST'],
    allowedHeaders: ['authorization', 'content-type', 'sdg-background'],
    credentials: false,
    maxAge: PREFLIGHT_MAX_AGE_SECONDS,
  };
  const closed: CorsOptions = { origin: false };
  return (req, callback) => callback(null, req.path.startsWith(RECIPIENT_PATH_PREFIX) ? recipient : closed);
}
