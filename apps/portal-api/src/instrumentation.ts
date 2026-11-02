/**
 * Preloaded with `node --import ./dist/instrumentation.js dist/main.js` (Dockerfile, Helm chart, compose), so it runs
 * before Nest, Express, pg and pino are first imported. Without OTEL_EXPORTER_OTLP_ENDPOINT it does nothing (doc 20,
 * "missing config means not wired up"); see telemetry/bootstrap.ts.
 */
import { bootstrapTelemetry } from './telemetry/bootstrap.js';

await bootstrapTelemetry();
