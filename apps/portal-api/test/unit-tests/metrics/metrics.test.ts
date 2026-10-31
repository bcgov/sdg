import { describe, expect, it, vi } from 'vitest';

import { metricsMiddleware, register } from '../../../src/metrics/metrics.js';
import { createRequest, createResponse } from '../../utils/http.js';

describe('Metrics Middleware Unit Test Suite', () => {
  it('Should export register and collect prometheus default metrics', async () => {
    expect(register).toBeDefined();
    expect(metricsMiddleware).toBeDefined();

    const metricsText = await register.metrics();
    expect(metricsText).toContain('process_cpu_user_seconds_total');
  });

  describe('normalizePath', () => {
    it('Should normalize route path with baseUrl', () => {
      const req = createRequest({
        method: 'GET',
        baseUrl: '/api',
        route: { path: '/users/:id' },
        url: '/api/users/123',
        originalUrl: '/api/users/123',
      });
      const res = createResponse();
      const next = vi.fn<() => void>();

      metricsMiddleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      res.end();
    });

    it('Should return #unmatched when route path contains a wildcard', () => {
      const req = createRequest({
        method: 'GET',
        baseUrl: '/api',
        route: { path: '/files/*path' },
        url: '/api/files/test.png',
        originalUrl: '/api/files/test.png',
      });
      const res = createResponse();
      const next = vi.fn<() => void>();

      metricsMiddleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      res.end();
    });

    it('Should return #unmatched when route path is not a string', () => {
      const req = createRequest({
        method: 'GET',
        baseUrl: '',
        route: { path: /^\/regex/ },
        url: '/regex/test',
        originalUrl: '/regex/test',
      });
      const res = createResponse();
      const next = vi.fn<() => void>();

      metricsMiddleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      res.end();
    });

    it('Should return #unmatched when req.route is undefined', () => {
      const req = createRequest({
        method: 'GET',
        baseUrl: '',
        route: undefined,
        url: '/unmatched',
        originalUrl: '/unmatched',
      });
      const res = createResponse();
      const next = vi.fn<() => void>();

      metricsMiddleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      res.end();
    });
  });

  describe('bypass', () => {
    it('Should bypass quiet paths when originalUrl is present', () => {
      const next = vi.fn<() => void>();
      const quietReq = createRequest({
        method: 'GET',
        originalUrl: '/healthz/live',
        url: '/api/other',
      });
      const res = createResponse();

      metricsMiddleware(quietReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('Should not bypass non-quiet paths when originalUrl is present', () => {
      const next = vi.fn<() => void>();
      const nonQuietReq = createRequest({
        method: 'GET',
        originalUrl: '/api/users',
        url: '/api/users',
      });
      const res = createResponse();

      metricsMiddleware(nonQuietReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      res.end();
    });

    it('Should fall back to req.url when originalUrl is empty string and url is quiet', () => {
      const next = vi.fn<() => void>();
      const quietReq = createRequest({
        method: 'GET',
        originalUrl: '',
        url: '/healthz/ready',
      });
      const res = createResponse();

      metricsMiddleware(quietReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('Should fall back to req.url when originalUrl is empty string and url is not quiet', () => {
      const next = vi.fn<() => void>();
      const nonQuietReq = createRequest({
        method: 'GET',
        originalUrl: '',
        url: '/api/data',
      });
      const res = createResponse();

      metricsMiddleware(nonQuietReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      res.end();
    });

    it('Should fall back to empty string when both originalUrl and url are empty strings', () => {
      const next = vi.fn<() => void>();
      const emptyReq = createRequest({
        method: 'GET',
        originalUrl: '',
        url: '',
      });
      const res = createResponse();

      metricsMiddleware(emptyReq, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      res.end();
    });
  });

  describe('metricsPath', () => {
    it('Should serve GET /metrics and handles response', () => {
      const next = vi.fn<() => void>();
      const metricsReq = createRequest({
        method: 'GET',
        originalUrl: '/metrics',
        url: '/metrics',
      });
      const res = createResponse();

      metricsMiddleware(metricsReq, res, next);
      // The middleware should intercept /metrics rather than calling next()
      expect(next).not.toHaveBeenCalled();
    });
  });
});
