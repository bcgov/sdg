/**
 * Preloaded with `node --import ./dist/instrumentation.js dist/main.js` (Dockerfile, Helm chart, compose), so it runs
 * before Nest, Express, pg and pino are first imported. It always starts the SDK for /metrics (doc 21); traces and logs
 * are exported only with OTEL_EXPORTER_OTLP_ENDPOINT (doc 20). See @repo/server-core/telemetry.
 */
import { bootstrapTelemetry } from '@repo/server-core/telemetry';

await bootstrapTelemetry({ serviceName: 'admin-api' });
