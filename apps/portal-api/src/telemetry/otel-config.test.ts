import { describe, expect, it, vi } from 'vitest';

import { resolveOtelConfig, shouldTraceIncoming } from './otel-config.js';

const endpoint = 'http://alloy:4318';

describe('resolveOtelConfig', () => {
  describe('missing config', () => {
    it('returns null when OTEL_EXPORTER_OTLP_ENDPOINT is unset', () => {
      const report = vi.fn<(message: string) => void>();
      expect(resolveOtelConfig({}, report)).toBeNull();
      expect(resolveOtelConfig({ OTEL_SERVICE_NAME: 'x', OTEL_TRACES_SAMPLER_ARG: '0.5' }, report)).toBeNull();
      expect(report).not.toHaveBeenCalled();
    });

    it('returns null when OTEL_EXPORTER_OTLP_ENDPOINT is an empty string', () => {
      const report = vi.fn<(message: string) => void>();
      expect(resolveOtelConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: '' }, report)).toBeNull();
      expect(resolveOtelConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: '   ' }, report)).toBeNull();
      expect(report).not.toHaveBeenCalled();
    });
  });

  describe('configured', () => {
    it('returns the endpoint, service name portal-api and sampler ratio 1 by default', () => {
      expect(resolveOtelConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: `${endpoint}/` })).toEqual({
        endpoint,
        serviceName: 'portal-api',
        resourceAttributes: {},
        samplerRatio: 1,
      });
    });

    it('honours OTEL_SERVICE_NAME, OTEL_RESOURCE_ATTRIBUTES and OTEL_TRACES_SAMPLER_ARG', () => {
      const config = resolveOtelConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.com',
        OTEL_SERVICE_NAME: 'portal-api-canary',
        OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment=pr-12, team=sdg%20portal,broken,=x',
        OTEL_TRACES_SAMPLER_ARG: '0.25',
      });
      expect(config?.endpoint).toBe('https://collector.example.com');
      expect(config?.serviceName).toBe('portal-api-canary');
      expect(config?.resourceAttributes).toEqual({ 'deployment.environment': 'pr-12', team: 'sdg portal' });
      expect(config?.samplerRatio).toBe(0.25);
    });

    it('skips a resource attribute with a broken percent-escape and keeps the rest', () => {
      const config = resolveOtelConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4318',
        OTEL_RESOURCE_ATTRIBUTES: 'bad=%E0%A4%A,deployment.environment=test',
      });
      expect(config?.resourceAttributes).toEqual({ 'deployment.environment': 'test' });
      expect(config?.resourceAttributes).not.toHaveProperty('bad');
      expect(config?.endpoint).toBe('http://alloy:4318');
    });
  });

  describe('invalid config', () => {
    it('returns null and reports the key (not the value) for a non-http endpoint', () => {
      const report = vi.fn<(message: string) => void>();
      expect(resolveOtelConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'grpc://secret-host:4317' }, report)).toBeNull();
      expect(report).toHaveBeenCalledTimes(1);
      const message = String(report.mock.calls[0]?.[0]);
      expect(message).toContain('OTEL_EXPORTER_OTLP_ENDPOINT');
      expect(message).not.toContain('secret-host');
    });

    it('returns null for a sampler ratio outside 0–1', () => {
      const report = vi.fn<(message: string) => void>();
      expect(
        resolveOtelConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_TRACES_SAMPLER_ARG: '1.5' }, report),
      ).toBeNull();
      expect(
        resolveOtelConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_TRACES_SAMPLER_ARG: 'half' }, report),
      ).toBeNull();
      expect(report).toHaveBeenCalledTimes(2);
      expect(String(report.mock.calls[0]?.[0])).toContain('OTEL_TRACES_SAMPLER_ARG');
    });
  });

  describe('quiet paths', () => {
    it('ignores /healthz/live, /healthz/ready, /metrics and the inbox stream via isQuietPath', () => {
      expect(shouldTraceIncoming('/healthz/live')).toBe(false);
      expect(shouldTraceIncoming('/healthz/ready')).toBe(false);
      expect(shouldTraceIncoming('/metrics')).toBe(false);
      expect(shouldTraceIncoming('/metrics?name[]=x')).toBe(false);
      expect(shouldTraceIncoming('/api/v1/notifications/inbox/stream')).toBe(false);
    });

    it('traces /api/* requests', () => {
      expect(shouldTraceIncoming('/api/auth/me')).toBe(true);
      expect(shouldTraceIncoming('/api/v1/things/1')).toBe(true);
      expect(shouldTraceIncoming('/metrics-and-more')).toBe(true);
      expect(shouldTraceIncoming('/api/v1/notifications/inbox')).toBe(true);
    });
  });
});
