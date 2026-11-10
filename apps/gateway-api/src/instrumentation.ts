/**
 * Preloaded with `node --import ./dist/instrumentation.js dist/main.js` (Dockerfile, Helm chart, compose), so it runs
 * before Nest, Express and pino are first imported. It always starts the SDK for /metrics; traces and logs are
 * exported only with OTEL_EXPORTER_OTLP_ENDPOINT. See @repo/server-core/telemetry.
 */
import { bootstrapTelemetry } from '@repo/server-core/telemetry';

await bootstrapTelemetry({ serviceName: 'gateway-api' });
