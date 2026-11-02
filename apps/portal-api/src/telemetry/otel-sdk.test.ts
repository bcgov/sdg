import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';

import { context, logs, propagation, trace } from '@opentelemetry/api';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { afterAll, describe, expect, it } from 'vitest';

import { createInstrumentations, type OtelProviders, startOtel } from './otel-sdk.js';

// Ratio 0: spans aren't sampled, so nothing is exported to the (unreachable) endpoint when the providers shut down.
const config = { endpoint: 'http://127.0.0.1:9', serviceName: 'portal-api', resourceAttributes: {}, samplerRatio: 0 };
let providers: OtelProviders | undefined;

function request(url?: string): IncomingMessage {
  const message = new IncomingMessage(new Socket());
  if (url !== undefined) message.url = url;
  return message;
}

afterAll(async () => {
  await providers?.shutdown();
  trace.disable();
  logs.disable();
  propagation.disable();
  context.disable();
});

describe('createInstrumentations', () => {
  it('instruments HTTP, Express, Nest, pg and pino', () => {
    const names = createInstrumentations().map((instrumentation) => instrumentation.instrumentationName);
    expect(names).toEqual([
      '@opentelemetry/instrumentation-http',
      '@opentelemetry/instrumentation-express',
      '@opentelemetry/instrumentation-nestjs-core',
      '@opentelemetry/instrumentation-pg',
      '@opentelemetry/instrumentation-pino',
    ]);
  });

  it('does not trace probes and scrapes', () => {
    const http = createInstrumentations()[0];
    if (!(http instanceof HttpInstrumentation)) throw new Error('first instrumentation is not HTTP');
    const ignore = http.getConfig().ignoreIncomingRequestHook;
    expect(ignore?.(request('/healthz/ready'))).toBe(true);
    expect(ignore?.(request('/metrics'))).toBe(true);
    expect(ignore?.(request('/api/auth/me'))).toBe(false);
    expect(ignore?.(request(undefined))).toBe(false);
  });
});

describe('startOtel', () => {
  it('registers the tracer and logger providers and the W3C propagator globally', () => {
    providers = startOtel(config);
    const carrier: Record<string, string> = {};
    const span = trace.getTracer('test').startSpan('probe');
    propagation.inject(trace.setSpan(context.active(), span), carrier);
    span.end();
    expect(span.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
    // Propagated even when not sampled (flags 00), so portal-api never breaks a trace started upstream.
    expect(carrier.traceparent).toMatch(new RegExp(`^00-${span.spanContext().traceId}-[0-9a-f]{16}-00$`));
    expect(logs.getLoggerProvider()).toBe(providers.loggerProvider);
  });
});
