import { createServer, type IncomingMessage } from 'node:http';
import { Writable } from 'node:stream';

import { ConsoleLogger, Logger } from '@nestjs/common';
import { Logger as NestPinoLogger, PinoLogger } from 'nestjs-pino';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';

import { isQuietPath } from '../http/quiet-paths.js';
import { describeError } from './describe-error.js';
import { pinoHttpOptions } from './logging.module.js';

interface LogLine {
  req: { url: string; headers: Record<string, string> };
  res: { statusCode: number; headers: Record<string, string> };
}

function captureLines(): { stream: Writable; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        const parsed: LogLine = JSON.parse(line);
        lines.push(parsed);
      }
      done();
    },
  });
  return { stream, lines };
}

describe('isQuietPath', () => {
  it('matches the probes and the metrics scrape, with or without a query string', () => {
    const urls = ['/metrics', '/metrics?x=1', '/healthz/live', '/healthz/ready', '/healthz/ready?full=1'];
    expect(urls.filter((url) => !isQuietPath(url))).toEqual([]);
  });

  it('does not match API routes or look-alikes', () => {
    const urls = ['/api/v1/notifications', '/metrics-old', '/api/metrics', '/healthzz', '/api/healthz/live', '/'];
    expect(urls.filter((url) => isQuietPath(url))).toEqual([]);
  });
});

describe('pinoHttpOptions', () => {
  it('uses LOG_LEVEL and pino-pretty only in development', () => {
    const dev = pinoHttpOptions({ NODE_ENV: 'development', LOG_LEVEL: 'debug' });
    expect(dev.level).toBe('debug');
    expect(dev.transport).toEqual(expect.objectContaining({ target: 'pino-pretty' }));
    const prod = pinoHttpOptions({ NODE_ENV: 'production', LOG_LEVEL: 'info' });
    expect(prod.level).toBe('info');
    expect(prod.transport).toBeUndefined();
    expect(pinoHttpOptions({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }).transport).toBeUndefined();
  });

  it('logs API requests, skips /healthz and /metrics, and redacts cookie, authorization and set-cookie', async () => {
    const { stream, lines } = captureLines();
    const { transport: _transport, ...options } = pinoHttpOptions({ NODE_ENV: 'production', LOG_LEVEL: 'info' });
    const logger = pinoHttp({ ...options, logger: pino({ level: 'info', redact: options.redact }, stream) });
    const server = createServer((req: IncomingMessage, res) => {
      logger(req, res);
      res.setHeader('set-cookie', 'sid=secret-session; HttpOnly');
      res.end('ok');
    });

    await supertest(server)
      .get('/api/v1/notifications')
      .set('cookie', 'sid=secret-cookie')
      .set('authorization', 'Bearer secret-token');
    await supertest(server).get('/healthz/live');
    await supertest(server).get('/healthz/ready');
    await supertest(server).get('/metrics');

    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line!.req.url).toBe('/api/v1/notifications');
    expect(line!.res.statusCode).toBe(200);
    expect(line!.req.headers.cookie).toBe('[Redacted]');
    expect(line!.req.headers.authorization).toBe('[Redacted]');
    expect(line!.res.headers['set-cookie']).toBe('[Redacted]');
    expect(JSON.stringify(lines)).not.toMatch(/secret-(cookie|token|session)/);
  });
});

describe('Nest Logger through nestjs-pino', () => {
  // warn(msg, stack) drops the stack (pino treats it as a printf argument). { msg, error } survives; under `err`
  // pino's own error serializer would rebuild the summary and drop its cause.
  it('writes msg and the error summary when a Nest Logger logs { msg, error }', () => {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        for (const line of chunk.toString().split('\n').filter(Boolean)) lines.push(JSON.parse(line));
        done();
      },
    });
    const options = pinoHttpOptions({ NODE_ENV: 'production', LOG_LEVEL: 'info' });
    Logger.overrideLogger(new NestPinoLogger(new PinoLogger({ pinoHttp: [options, stream] }), {}));
    try {
      const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      new Logger('HealthController').warn({
        msg: 'Issuer check failed',
        error: describeError(new Error('fetch failed', { cause })),
      });
    } finally {
      Logger.overrideLogger(new ConsoleLogger());
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 40,
      context: 'HealthController',
      msg: 'Issuer check failed',
      error: { type: 'Error', message: 'fetch failed', cause: { code: 'ECONNREFUSED' } },
    });
    expect(JSON.stringify(lines[0])).toContain('at ');
  });
});
