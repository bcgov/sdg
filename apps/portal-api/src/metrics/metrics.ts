import type { Request } from 'express';
import promBundle from 'express-prom-bundle';
import * as prom from 'prom-client';

import { isQuietPath } from '../http/quiet-paths.js';

/** Process-wide registry; created once per process, so a second Nest app reuses it instead of re-registering. */
const register = new prom.Registry();
prom.collectDefaultMetrics({ register });

/**
 * The matched route template (e.g. /api/v1/things/:id), so ids never become labels. A request that reached no
 * controller still carries the route of the last Nest middleware it passed (a `*path` wildcard), so wildcard
 * matches share one `#unmatched` label and scanners can't inflate cardinality.
 */
function normalizePath(req: Request): string {
  const route: unknown = req.route?.path;
  return typeof route === 'string' && !route.includes('*') ? `${req.baseUrl}${route}` : '#unmatched';
}

/** Serves GET /metrics (outside /api, so Caddy never proxies it) and times every other non-probe request. */
const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true,
  metricsPath: '/metrics',
  promRegistry: register,
  bypass: (req) => isQuietPath(req.originalUrl || req.url),
  normalizePath,
});

export { metricsMiddleware, register };
