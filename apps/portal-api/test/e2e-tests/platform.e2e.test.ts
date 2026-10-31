import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../utils/app.js';

describe('Portal API Platform Middleware Integration Test Suite', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  describe('helmet', () => {
    it('Should set security headers on API, probe and 404 responses', async () => {
      const responses = await Promise.all(
        ['/api/auth/me', '/healthz/live', '/api/unknown'].map((path) => t.http().get(path)),
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
    it('Should serve Prometheus text with default process metrics, outside /api and without a session', async () => {
      const res = await t.http().get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/plain/);
      expect(res.text).toContain('process_cpu_user_seconds_total');
      expect(res.text).toContain('nodejs_heap_size_total_bytes');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect((await t.http().get('/prom-metrics')).status).toBe(404);
      expect((await t.http().get('/api/metrics')).status).toBe(404);
    });

    it('Should record matched API routes with method, path and status code', async () => {
      await t.http().get('/api/auth/me');
      const metrics = (await t.http().get('/metrics')).text;
      expect(metrics).toMatch(
        /http_request_duration_seconds_count\{[^}]*status_code="401"[^}]*method="GET"[^}]*path="\/api\/auth\/me"[^}]*\} [1-9]/,
      );
    });

    it('does not record /healthz probes or /metrics scrapes', async () => {
      await t.http().get('/healthz/live');
      await t.http().get('/healthz/ready');
      await t.http().get('/metrics');
      const metrics = (await t.http().get('/metrics')).text;
      expect(metrics).not.toMatch(/path="\/healthz/);
      expect(metrics).not.toMatch(/path="\/metrics"/);
    });

    it('Should label requests that match no route as #unmatched', async () => {
      await t.http().get('/api/wp-admin/setup-config.php');
      const metrics = (await t.http().get('/metrics')).text;
      expect(metrics).toMatch(/status_code="404"[^}]*path="#unmatched"/);
      expect(metrics).not.toContain('wp-admin');
    });

    it('Should allow a second app in the same process (registry is a module singleton)', async () => {
      const second = await createTestApp();
      try {
        expect((await second.http().get('/metrics')).status).toBe(200);
      } finally {
        await second.close();
      }
    });
  });
});
