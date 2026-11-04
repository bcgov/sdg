import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

/**
 * The one Prometheus exporter in the process (doc 21). The SDK started by the `--import` preload reads into it and
 * GET /metrics (metrics/metrics.ts) serves it; both import this module, so they share the instance. It never opens
 * its own port: /metrics is served on the app port.
 */
export const prometheusExporter = new PrometheusExporter({ preventServerStart: true });
