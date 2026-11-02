import { createRequire } from 'node:module';
import { Writable } from 'node:stream';

import { context, logs, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import type pinoFactory from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { pinoHttpOptions } from '../logging/logging.module.js';

const logExporter = new InMemoryLogRecordExporter();
const spanExporter = new InMemorySpanExporter();
// The providers the SDK builds with an OTLP endpoint, with in-memory exporters (otel-sdk.test.ts covers the SDK).
let tracerProvider: TracerProvider;
let loggerProvider: LoggerProvider;
let instrumentation: PinoInstrumentation;
let pino: typeof pinoFactory;
let lines: Record<string, unknown>[];

function isPinoFactory(value: unknown): value is typeof pinoFactory {
  return typeof value === 'function';
}

/** A pino logger with the app's redaction, writing parsed JSON lines into `lines`. */
function createLogger() {
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const line: unknown = JSON.parse(chunk.toString());
      if (typeof line === 'object' && line !== null) lines.push({ ...line });
      callback();
    },
  });
  const { redact } = pinoHttpOptions({ NODE_ENV: 'production', LOG_LEVEL: 'info' });
  return pino({ redact }, destination);
}

beforeAll(() => {
  tracerProvider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })] });
  loggerProvider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter: logExporter })] });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(tracerProvider);
  logs.setGlobalLoggerProvider(loggerProvider);
  instrumentation = new PinoInstrumentation();
  instrumentation.enable();
  // require() after enable(), so require-in-the-middle patches pino as it would in the app.
  const loaded: unknown = createRequire(import.meta.url)('pino');
  if (!isPinoFactory(loaded)) throw new Error('pino did not load as a function');
  pino = loaded;
});

afterAll(async () => {
  instrumentation.disable();
  await Promise.all([tracerProvider.shutdown(), loggerProvider.shutdown()]);
  trace.disable();
  logs.disable();
  context.disable();
});

beforeEach(async () => {
  // Flush records batched by an earlier test before clearing, so each test sees only its own.
  await loggerProvider.forceFlush();
  lines = [];
  logExporter.reset();
});

describe('log correlation', () => {
  it('adds trace_id, span_id and trace_flags to pino lines written inside an active span', () => {
    const logger = createLogger();
    const span = trace.getTracer('test').startSpan('request');
    context.with(trace.setSpan(context.active(), span), () => logger.info('inside'));
    span.end();
    const { traceId, spanId } = span.spanContext();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'inside', trace_id: traceId, span_id: spanId, trace_flags: '01' });
  });

  it('writes no trace fields outside a span', () => {
    createLogger().info('outside');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.msg).toBe('outside');
    expect(lines[0]).not.toHaveProperty('trace_id');
    expect(lines[0]).not.toHaveProperty('span_id');
  });

  it('exports each pino record as an OTLP log record with severity and body', async () => {
    const logger = createLogger();
    logger.warn({ route: '/api/auth/me' }, 'slow upstream');
    await loggerProvider.forceFlush();
    const records = logExporter.getFinishedLogRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.body).toBe('slow upstream');
    expect(records[0]?.severityText).toBe('warn');
    expect(records[0]?.attributes).toMatchObject({ route: '/api/auth/me' });
  });

  it('redacts cookie, authorization and set-cookie in exported OTLP log records', async () => {
    const logger = createLogger();
    logger.info(
      {
        req: { headers: { cookie: 'portal.sid=s3cret', authorization: 'Bearer t0ken' } },
        res: { headers: { 'set-cookie': 'portal.sid=n3w' } },
      },
      'request completed',
    );
    await loggerProvider.forceFlush();
    const exported = JSON.stringify(logExporter.getFinishedLogRecords().map((record) => record.attributes));
    expect(exported).toContain('[Redacted]');
    for (const secret of ['s3cret', 't0ken', 'n3w']) {
      expect(exported).not.toContain(secret);
      expect(JSON.stringify(lines)).not.toContain(secret);
    }
  });
});
