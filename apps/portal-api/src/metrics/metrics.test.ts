import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, createResponse } from '../../test/utils/http.js';
import { prometheusExporter } from '../telemetry/prometheus.js';
import { metricsMiddleware } from './metrics.js';

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
