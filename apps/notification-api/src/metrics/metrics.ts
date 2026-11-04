import type { NextFunction, Request, Response } from 'express';

import { prometheusExporter } from '../telemetry/prometheus.js';

/** GET|HEAD /metrics, with or without a trailing slash (any query string is ignored). */
function isMetricsRequest(req: Request): boolean {
  return (req.method === 'GET' || req.method === 'HEAD') && /^\/metrics\/?$/.test(req.path);
}

/**
 * Serves GET /metrics (outside /api, so Caddy never proxies it) from the OpenTelemetry Prometheus exporter (doc 21).
 * Requests are timed by the HTTP instrumentation, not here; /healthz/* and /metrics are skipped there (isQuietPath).
 */
function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isMetricsRequest(req)) prometheusExporter.getMetricsRequestHandler(req, res);
  else next();
}

export { metricsMiddleware };
