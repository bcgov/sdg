import { metrics } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, type LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { MetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  type SpanExporter,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

import { type OtelConfig, shouldTraceIncoming } from './otel-config.js';
import { prometheusExporter } from './prometheus.js';

/** Used for the resource when no OTLP config exists (OTEL_SERVICE_NAME is read only with an endpoint). */
const DEFAULT_SERVICE_NAME = 'notification-api';

export interface OtelHandle {
  /** True when traces and logs are exported over OTLP; metrics are always served on /metrics. */
  readonly exportsTelemetry: boolean;
  /** Flushes and stops every provider. */
  shutdown(): Promise<void>;
}

export interface OtelExporters {
  readonly spans?: SpanExporter;
  readonly logs?: LogRecordExporter;
  /** Defaults to the process-wide Prometheus exporter, which can be bound to one SDK only. */
  readonly metrics?: MetricReader;
}

/**
 * HTTP and Express (request duration with the matched route) and the Node runtime always; Nest, pg, pino (spans,
 * trace ids on log lines, an OTLP copy of logs) and undici (client spans and `traceparent` on fetch: webhook, callback
 * and relay calls, KTD3) only when tracing is on.
 */
export function createInstrumentations({ tracing }: { tracing: boolean }): Instrumentation[] {
  const always: Instrumentation[] = [
    new HttpInstrumentation({ ignoreIncomingRequestHook: (request) => !shouldTraceIncoming(request.url ?? '') }),
    new ExpressInstrumentation(),
    new RuntimeNodeInstrumentation(),
  ];
  if (!tracing) return always;
  return [
    ...always,
    new NestInstrumentation(),
    new PgInstrumentation(),
    new PinoInstrumentation(),
    new UndiciInstrumentation(),
  ];
}

/** Resident set size as semconv `process.memory.usage` (Prometheus: process_memory_usage_bytes). */
function observeProcessMemory(): void {
  metrics
    .getMeter(DEFAULT_SERVICE_NAME)
    .createObservableUpDownCounter('process.memory.usage', { unit: 'By', description: 'Resident set size.' })
    .addCallback((result) => result.observe(process.memoryUsage.rss()));
}

/**
 * Builds the SDK with every input explicit, so its OTEL_*_EXPORTER defaults (OTLP to localhost) never apply and no
 * host or process attributes are detected. With a config, traces and logs go to `<endpoint>/v1/traces` and
 * `/v1/logs`; without one, there are no span or log processors. Tests pass in-memory exporters and their own reader.
 */
export function createSdk(config: OtelConfig | null, exporters: OtelExporters = {}): NodeSDK {
  const resource = defaultResource().merge(
    resourceFromAttributes({
      ...config?.resourceAttributes,
      [ATTR_SERVICE_NAME]: config?.serviceName ?? DEFAULT_SERVICE_NAME,
    }),
  );
  return new NodeSDK({
    resource,
    autoDetectResources: false,
    contextManager: new AsyncLocalStorageContextManager(),
    textMapPropagator: new W3CTraceContextPropagator(),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config?.samplerRatio ?? 0) }),
    metricReaders: [exporters.metrics ?? prometheusExporter],
    spanProcessors: config
      ? [
          new BatchSpanProcessor({
            exporter: exporters.spans ?? new OTLPTraceExporter({ url: `${config.endpoint}/v1/traces` }),
          }),
        ]
      : [],
    logRecordProcessors: config
      ? [
          new BatchLogRecordProcessor({
            exporter: exporters.logs ?? new OTLPLogExporter({ url: `${config.endpoint}/v1/logs` }),
          }),
        ]
      : [],
    instrumentations: createInstrumentations({ tracing: config !== null }),
  });
}

/** Starts the SDK and registers it globally. Call before the instrumented libraries are first imported. */
export function startOtel(config: OtelConfig | null): OtelHandle {
  const sdk = createSdk(config);
  sdk.start();
  observeProcessMemory();
  return { exportsTelemetry: config !== null, shutdown: () => sdk.shutdown() };
}
