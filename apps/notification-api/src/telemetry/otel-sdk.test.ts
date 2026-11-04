import { createServer, type IncomingHttpHeaders } from 'node:http';

import { context, logs, metrics, propagation, ProxyTracerProvider, SpanKind, trace } from '@opentelemetry/api';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs';
import type { NodeSDK } from '@opentelemetry/sdk-node';
import { InMemorySpanExporter, TracerProvider } from '@opentelemetry/sdk-trace';
import { afterEach, describe, expect, it } from 'vitest';

import { createInstrumentations, createSdk } from './otel-sdk.js';

const config = {
  endpoint: 'http://127.0.0.1:9',
  serviceName: 'notification-api-test',
  resourceAttributes: {},
  samplerRatio: 1,
};
let sdk: NodeSDK | undefined;

function instrumentationNames(tracing: boolean): string[] {
  return createInstrumentations({ tracing }).map((instrumentation) => instrumentation.instrumentationName);
}

afterEach(async () => {
  await sdk?.shutdown();
  sdk = undefined;
  for (const api of [trace, logs, metrics, propagation, context]) api.disable();
});

describe('createInstrumentations', () => {
  it('always instruments HTTP, Express and the Node runtime, and adds Nest, pg, pino and undici when tracing', () => {
    const always = [
      '@opentelemetry/instrumentation-http',
      '@opentelemetry/instrumentation-express',
      '@opentelemetry/instrumentation-runtime-node',
    ];
    expect(instrumentationNames(false)).toEqual(always);
    expect(instrumentationNames(true)).toEqual([
      ...always,
      '@opentelemetry/instrumentation-nestjs-core',
      '@opentelemetry/instrumentation-pg',
      '@opentelemetry/instrumentation-pino',
      '@opentelemetry/instrumentation-undici',
    ]);
  });
});

describe('fetch with tracing on (KTD3)', () => {
  it('records a client span and sends its traceparent', async () => {
    let received: IncomingHttpHeaders = {};
    const server = createServer((req, res) => {
      received = req.headers;
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const spans = new InMemorySpanExporter();
    sdk = createSdk(config, {
      spans,
      logs: new InMemoryLogRecordExporter(),
      metrics: new PrometheusExporter({ preventServerStart: true }),
    });
    sdk.start();

    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('server has no TCP address');
      const { port } = address;
      await (await fetch(`http://127.0.0.1:${port}/hook`, { method: 'POST' })).text();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    const provider = trace.getTracerProvider();
    const delegate = provider instanceof ProxyTracerProvider ? provider.getDelegate() : provider;
    if (delegate instanceof TracerProvider) await delegate.forceFlush();

    const client = spans.getFinishedSpans().find((span) => span.kind === SpanKind.CLIENT && span.name === 'POST');
    expect(client).toBeDefined();
    expect(received.traceparent).toBe(`00-${client!.spanContext().traceId}-${client!.spanContext().spanId}-01`);
  });
});
