import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prometheusExporter } from '../../telemetry/prometheus.js';
import { metricsMiddleware } from './metrics.js';

function isRequest(value: unknown): value is Request {
  return value instanceof IncomingMessage;
}

function isResponse(value: unknown): value is Response {
  return value instanceof ServerResponse;
}

/** The fields the middleware reads (method, Express's `path`) on a real IncomingMessage. */
function createRequest({ method, path }: { method: string; path: string }): Request {
  const req: unknown = Object.assign(new IncomingMessage(new Socket()), { method, path });
  if (!isRequest(req)) throw new Error('Invalid request');
  return req;
}

function createResponse(): Response {
  const res: unknown = new ServerResponse(new IncomingMessage(new Socket()));
  if (!isResponse(res)) throw new Error('Invalid response');
  return res;
}

describe('Metrics Middleware Unit Test Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('isMetricsRequest matches GET or HEAD /metrics', () => {
    it.each([
      { method: 'GET', path: '/metrics' },
      { method: 'GET', path: '/metrics/' },
      { method: 'HEAD', path: '/metrics' },
      { method: 'HEAD', path: '/metrics/' },
    ])('should serve metrics for $method $path', ({ method, path }) => {
      const handlerSpy = vi.spyOn(prometheusExporter, 'getMetricsRequestHandler').mockImplementation(() => {});
      const req = createRequest({ method, path });
      const res = createResponse();
      const next = vi.fn<() => void>();

      metricsMiddleware(req, res, next);

      expect(handlerSpy).toHaveBeenCalledTimes(1);
      expect(handlerSpy).toHaveBeenCalledWith(req, res);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('isMetricsRequest ignores non-matching requests', () => {
    it.each([
      { method: 'POST', path: '/metrics' },
      { method: 'PUT', path: '/metrics' },
      { method: 'DELETE', path: '/metrics' },
      { method: 'GET', path: '/metrics/detail' },
      { method: 'GET', path: '/metric' },
      { method: 'GET', path: '/api/v1/users' },
      { method: 'GET', path: '/' },
    ])('should call next() for $method $path', ({ method, path }) => {
      const handlerSpy = vi.spyOn(prometheusExporter, 'getMetricsRequestHandler').mockImplementation(() => {});
      const req = createRequest({ method, path });
      const res = createResponse();
      const next = vi.fn<() => void>();

      metricsMiddleware(req, res, next);

      expect(handlerSpy).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
