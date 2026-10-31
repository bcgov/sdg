import { createServer, IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { Writable } from 'node:stream';

import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';

import { isQuietPath } from '../../../src/http/quiet-paths.js';
import { pinoHttpOptions } from '../../../src/logging/logging.module.js';

type QuietRequest = IncomingMessage & { originalUrl?: string };

function isAutoLoggingOptions(value: unknown): value is { ignore: (req: QuietRequest) => boolean } {
  return typeof value === 'object' && value !== null && 'ignore' in value && typeof value.ignore === 'function';
}

function createMockRequest(options: { originalUrl?: string; url?: string }): QuietRequest {
  const req = new IncomingMessage(new Socket());
  Object.defineProperty(req, 'url', {
    value: options.url,
    writable: true,
    configurable: true,
  });
  return Object.assign(req, { originalUrl: options.originalUrl });
}

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

describe('LoggingModule Unit Test Suite', () => {
  describe('isQuietPath', () => {
    it('Should match the probes and the metrics scrape, with or without a query string', () => {
      const urls = ['/metrics', '/metrics?x=1', '/healthz/live', '/healthz/ready', '/healthz/ready?full=1'];
      expect(urls.filter((url) => !isQuietPath(url))).toEqual([]);
    });

    it('Should not match API routes or look-alikes', () => {
      const urls = ['/api/auth/me', '/metrics-old', '/api/metrics', '/healthzz', '/api/healthz/live', '/'];
      expect(urls.filter((url) => isQuietPath(url))).toEqual([]);
    });
  });

  describe('pinoHttpOptions', () => {
    it('Should use LOG_LEVEL and pino-pretty only in development', () => {
      const dev = pinoHttpOptions({
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      });
      expect(dev.level).toBe('debug');
      expect(dev.transport).toEqual(expect.objectContaining({ target: 'pino-pretty' }));
      const prod = pinoHttpOptions({
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      });
      expect(prod.level).toBe('info');
      expect(prod.transport).toBeUndefined();
      expect(pinoHttpOptions({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }).transport).toBeUndefined();
    });

    it('Should log API requests, skips /healthz and /metrics, and redacts cookie, authorization and set-cookie', async () => {
      const { stream, lines } = captureLines();
      const { transport: _transport, ...options } = pinoHttpOptions({
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      });
      const logger = pinoHttp({
        ...options,
        logger: pino({ level: 'info', redact: options.redact }, stream),
      });
      const server = createServer((req: IncomingMessage, res) => {
        logger(req, res);
        res.setHeader('set-cookie', 'portal.sid=secret-session; HttpOnly');
        res.end('ok');
      });

      await supertest(server)
        .get('/api/auth/me')
        .set('cookie', 'portal.sid=secret-cookie')
        .set('authorization', 'Bearer secret-token');
      await supertest(server).get('/healthz/live');
      await supertest(server).get('/healthz/ready');
      await supertest(server).get('/metrics');

      expect(lines).toHaveLength(1);
      const [line] = lines;
      expect(line!.req.url).toBe('/api/auth/me');
      expect(line!.res.statusCode).toBe(200);
      expect(line!.req.headers.cookie).toBe('[Redacted]');
      expect(line!.req.headers.authorization).toBe('[Redacted]');
      expect(line!.res.headers['set-cookie']).toBe('[Redacted]');
      expect(JSON.stringify(lines)).not.toMatch(/secret-(cookie|token|session)/);
    });

    describe('autoLogging.ignore', () => {
      const options = pinoHttpOptions({
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      });
      const autoLogging = isAutoLoggingOptions(options.autoLogging) ? options.autoLogging : undefined;
      const ignore = autoLogging?.ignore;

      it('Should ignore quiet paths using req.originalUrl when present', () => {
        expect(ignore).toBeDefined();
        const quietReq = createMockRequest({
          originalUrl: '/healthz/live',
          url: '/api/something-else',
        });
        expect(ignore!(quietReq)).toBe(true);

        const nonQuietReq = createMockRequest({
          originalUrl: '/api/auth/me',
          url: '/healthz/live',
        });
        expect(ignore!(nonQuietReq)).toBe(false);
      });

      it('Should fallback to req.url when req.originalUrl is undefined', () => {
        expect(ignore).toBeDefined();
        const quietReq = createMockRequest({
          url: '/metrics',
        });
        expect(ignore!(quietReq)).toBe(true);

        const nonQuietReq = createMockRequest({
          url: '/api/auth/me',
        });
        expect(ignore!(nonQuietReq)).toBe(false);
      });

      it('Should fallback to empty string when both req.originalUrl and req.url are undefined', () => {
        expect(ignore).toBeDefined();
        const emptyReq = createMockRequest({});
        expect(ignore!(emptyReq)).toBe(false);
      });
    });
  });
});
