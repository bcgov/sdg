import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTelemetry } from '../../src/telemetry/bootstrap.js';
import type { OtelHandle } from '../../src/telemetry/otel-sdk.js';
import type { TestApp } from '../../src/testing/app.js';

/** Incoming-request series only (supertest's own requests also appear, as http_client_request_duration). */
function serverCounts(metrics: string): string[] {
  return metrics.split('\n').filter((line) => line.startsWith('http_server_request_duration_count{'));
}

// doc 21: OpenTelemetry (sdk-node + Prometheus exporter) produces every metric. As in production (the --import
// preload: loader hooks, then the SDK, no OTLP endpoint), the SDK starts before Nest and Express are first loaded, so
// the test app is imported afterwards.
describe('portal-api platform middleware', () => {
  let otel: OtelHandle;
  let createTestApp: typeof import('../../src/testing/app.js').createTestApp;
  let app: TestApp;

  beforeAll(async () => {
    otel = await bootstrapTelemetry({});
    ({ createTestApp } = await import('../../src/testing/app.js'));
    app = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await otel?.shutdown();
  }, 30_000);

  async function scrape(): Promise<string> {
    return (await app.http().get('/metrics')).text;
  }

  describe('helmet', () => {
    it('Should set security headers on API, probe and 404 responses', async () => {
      const responses = await Promise.all(
        ['/api/auth/me', '/healthz/live', '/api/unknown'].map((path) => app.http().get(path)),
      );
      for (const res of responses) {
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['content-security-policy']).toContain("default-src 'self'");
        expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
        expect(res.headers['x-powered-by']).toBeUndefined();
      }
    });
  });

  describe('GET /metrics', () => {
    it('Should serve Prometheus text with OTel runtime metrics, outside /api and without a session', async () => {
      const res = await app.http().get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/plain/);
      for (const name of [
        'nodejs_eventloop_delay_p99',
        'v8js_memory_heap_used',
        'process_memory_usage',
        'target_info',
      ]) {
        expect(res.text).toContain(name);
      }
      expect(res.headers['set-cookie']).toBeUndefined();
      expect((await app.http().get('/metrics/')).status).toBe(200);
      expect((await app.http().get('/prom-metrics')).status).toBe(404);
      expect((await app.http().get('/api/metrics')).status).toBe(404);
    });

    it('Should record matched API routes as http_server_request_duration with method, route and status code', async () => {
      await app.http().get('/api/auth/me');
      const match = serverCounts(await scrape()).find((line) => line.includes('http_route="/api/auth/me"'));
      expect(match).toBeDefined();
      expect(match).toContain('http_request_method="GET"');
      expect(match).toContain('http_response_status_code="401"');
      expect(Number(match?.split(' ').at(-1))).toBeGreaterThanOrEqual(1);
    });

    it('Should not record /healthz probes or /metrics scrapes', async () => {
      await app.http().get('/healthz/live');
      await app.http().get('/healthz/ready');
      await app.http().get('/metrics');
      const series = serverCounts(await scrape());
      expect(series.length).toBeGreaterThan(0);
      expect(series.join('\n')).not.toMatch(/http_route="\/(healthz|metrics)/);
      // Every probe and scrape answers 200; no request this suite times does.
      expect(series.filter((line) => line.includes('http_response_status_code="200"'))).toEqual([]);
    });

    it('Should label requests that match no route with the constant catch-all route, never the raw URL', async () => {
      await app.http().get('/api/wp-admin/setup-config.php');
      await app.http().get('/api/v1/things/42/../../etc/passwd');
      const metrics = await scrape();
      const routes = serverCounts(metrics)
        .filter((line) => line.includes('http_response_status_code="404"'))
        .map((line) => /http_route="([^"]*)"/.exec(line)?.[1]);
      // /api/* misses share Nest's catch-all route; misses outside /api (e.g. /prom-metrics) carry no route at all.
      expect(routes).toContain('/api*path');
      expect(new Set(routes)).toEqual(new Set(['/api*path', undefined]));
      expect(metrics).not.toContain('wp-admin');
      expect(metrics).not.toContain('passwd');
    });

    it('Should expose no prom-client series and no host or process attributes in target_info', async () => {
      const metrics = await scrape();
      expect(metrics).not.toContain('http_request_duration_seconds');
      expect(metrics).not.toContain('#unmatched');
      expect(metrics).not.toContain('process_cpu_user_seconds_total');
      expect(metrics).not.toMatch(/^up /m);
      const targetInfo = metrics.split('\n').find((line) => line.startsWith('target_info{'));
      expect(targetInfo).toContain('service_name="portal-api"');
      expect(targetInfo).not.toMatch(/host_name|process_pid|process_command/);
    });

    it('Should allow a second app in the same process (one exporter singleton)', async () => {
      const second = await createTestApp();
      try {
        const res = await second.http().get('/metrics');
        expect(res.status).toBe(200);
        expect(res.text).toContain('http_server_request_duration_count{');
      } finally {
        await second.close();
      }
    }, 60_000);
  });
});
