import { context, logs, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, type LogRecordExporter, LoggerProvider } from '@opentelemetry/sdk-logs';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  type SpanExporter,
  TraceIdRatioBasedSampler,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

import { type OtelConfig, shouldTraceIncoming } from './otel-config.js';

export interface OtelProviders {
  readonly tracerProvider: TracerProvider;
  readonly loggerProvider: LoggerProvider;
  /** Flushes and stops both providers. */
  shutdown(): Promise<void>;
}

/** Exporters default to OTLP/HTTP (protobuf) at the configured endpoint; tests pass in-memory ones. */
export function createProviders(
  config: OtelConfig,
  exporters: { spans?: SpanExporter; logs?: LogRecordExporter } = {},
): OtelProviders {
  const resource = defaultResource().merge(
    resourceFromAttributes({ ...config.resourceAttributes, [ATTR_SERVICE_NAME]: config.serviceName }),
  );
  const tracerProvider = new TracerProvider({
    resource,
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.samplerRatio) }),
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: exporters.spans ?? new OTLPTraceExporter({ url: `${config.endpoint}/v1/traces` }),
      }),
    ],
  });
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor({
        exporter: exporters.logs ?? new OTLPLogExporter({ url: `${config.endpoint}/v1/logs` }),
      }),
    ],
  });
  return {
    tracerProvider,
    loggerProvider,
    shutdown: async () => {
      await Promise.all([tracerProvider.shutdown(), loggerProvider.shutdown()]);
    },
  };
}

/** HTTP (incoming and outgoing), Express, Nest, pg, and pino (trace ids on every line plus an OTLP copy). */
export function createInstrumentations() {
  return [
    new HttpInstrumentation({ ignoreIncomingRequestHook: (request) => !shouldTraceIncoming(request.url ?? '') }),
    new ExpressInstrumentation(),
    new NestInstrumentation(),
    new PgInstrumentation(),
    new PinoInstrumentation(),
  ];
}

/** Registers the providers globally and patches the instrumented libraries. Call before they are first imported. */
export function startOtel(config: OtelConfig): OtelProviders {
  const providers = createProviders(config);
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(providers.tracerProvider);
  logs.setGlobalLoggerProvider(providers.loggerProvider);
  registerInstrumentations({ instrumentations: createInstrumentations() });
  return providers;
}
