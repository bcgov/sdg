import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';

import { context, logs, metrics, propagation, ProxyTracerProvider, trace } from '@opentelemetry/api';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { InMemoryLogRecordExporter, LoggerProvider } from '@opentelemetry/sdk-logs';
import type { NodeSDK } from '@opentelemetry/sdk-node';
import { InMemorySpanExporter, TracerProvider } from '@opentelemetry/sdk-trace';
import { afterEach, describe, expect, it } from 'vitest';

import { createInstrumentations, createSdk } from './otel-sdk.js';

const config = {
  endpoint: 'http://127.0.0.1:9',
  serviceName: 'core-api-canary',
  resourceAttributes: { 'deployment.environment': 'test' },
  samplerRatio: 1,
};
let sdk: NodeSDK | undefined;

function request(url?: string): IncomingMessage {
  const message = new IncomingMessage(new Socket());
  if (url !== undefined) message.url = url;
  return message;
}

function instrumentationNames(tracing: boolean): string[] {
  return createInstrumentations({ tracing }).map((instrumentation) => instrumentation.instrumentationName);
}

/** The SDK tracer provider behind the global proxy, or undefined when none is registered. */
function sdkTracerProvider(): TracerProvider | undefined {
  const global = trace.getTracerProvider();
  const delegate = global instanceof ProxyTracerProvider ? global.getDelegate() : global;
  return delegate instanceof TracerProvider ? delegate : undefined;
}

function sdkLoggerProvider(): LoggerProvider {
  const provider = logs.getLoggerProvider();
  if (!(provider instanceof LoggerProvider)) throw new Error('no SDK logger provider registered');
  return provider;
}

/** Starts an SDK with its own Prometheus reader (the process-wide one binds once) and returns the reader. */
function start(withConfig: typeof config | null, exporters: Parameters<typeof createSdk>[2] = {}) {
  const reader = new PrometheusExporter({ preventServerStart: true });
  sdk = createSdk('core-api', withConfig, { ...exporters, metrics: reader });
  sdk.start();
  return reader;
}

afterEach(async () => {
  await sdk?.shutdown();
  sdk = undefined;
  for (const api of [trace, logs, metrics, propagation, context]) api.disable();
});

describe('createInstrumentations', () => {
  it('always instruments HTTP, Express and the Node runtime (metrics need them)', () => {
    expect(instrumentationNames(false)).toEqual([
      '@opentelemetry/instrumentation-http',
      '@opentelemetry/instrumentation-express',
      '@opentelemetry/instrumentation-runtime-node',
    ]);
  });

  it('adds Nest, pg and pino only when tracing is on', () => {
    const names = instrumentationNames(true);
    expect(names.slice(0, 3)).toEqual(instrumentationNames(false));
    expect(names.slice(3)).toEqual([
      '@opentelemetry/instrumentation-nestjs-core',
      '@opentelemetry/instrumentation-pg',
      '@opentelemetry/instrumentation-pino',
    ]);
  });

  it('neither traces nor times probes and scrapes', () => {
    const http = createInstrumentations({ tracing: false })[0];
    if (!(http instanceof HttpInstrumentation)) throw new Error('first instrumentation is not HTTP');
    const ignore = http.getConfig().ignoreIncomingRequestHook;
    expect(ignore?.(request('/healthz/ready'))).toBe(true);
    expect(ignore?.(request('/metrics'))).toBe(true);
    expect(ignore?.(request('/api/auth/me'))).toBe(false);
    expect(ignore?.(request(undefined))).toBe(false);
  });
});

describe('startOtel without an OTLP endpoint', () => {
  it('binds the Prometheus exporter so metrics can be collected under the service name', async () => {
    const reader = start(null);
    metrics.getMeter('test').createCounter('probe').add(1);
    const { resourceMetrics, errors } = await reader.collect();
    expect(errors).toEqual([]);
    expect(resourceMetrics.resource.attributes['service.name']).toBe('core-api');
    const names = resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics.map((m) => m.descriptor.name));
    expect(names).toContain('probe');
  });

  it('registers no tracer provider and exports nothing', () => {
    start(null);
    const span = trace.getTracer('test').startSpan('probe');
    expect(span.isRecording()).toBe(false);
    span.end();
    expect(sdkTracerProvider()).toBeUndefined();
  });
});

describe('startOtel with an OTLP endpoint', () => {
  it('registers the tracer and logger providers and the W3C propagator globally', async () => {
    const spans = new InMemorySpanExporter();
    const logRecords = new InMemoryLogRecordExporter();
    start(config, { spans, logs: logRecords });

    const carrier: Record<string, string> = {};
    const span = trace.getTracer('test').startSpan('probe');
    propagation.inject(trace.setSpan(context.active(), span), carrier);
    span.end();
    logs.getLogger('test').emit({ body: 'hello' });
    await sdkTracerProvider()?.forceFlush();
    await sdkLoggerProvider().forceFlush();

    expect(carrier.traceparent).toMatch(new RegExp(`^00-${span.spanContext().traceId}-[0-9a-f]{16}-01$`));
    expect(spans.getFinishedSpans().map((s) => s.name)).toEqual(['probe']);
    expect(logRecords.getFinishedLogRecords().map((r) => r.body)).toEqual(['hello']);
  });

  it('keeps host and process attributes off the resource', async () => {
    const reader = start(config, { spans: new InMemorySpanExporter(), logs: new InMemoryLogRecordExporter() });
    const { attributes } = (await reader.collect()).resourceMetrics.resource;
    expect(attributes['service.name']).toBe('core-api-canary');
    expect(attributes['deployment.environment']).toBe('test');
    expect(Object.keys(attributes).filter((key) => /^(host|process|os)\./.test(key))).toEqual([]);
  });
});
