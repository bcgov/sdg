import { bootstrapTelemetry, type OtelHandle } from '@repo/server-core/telemetry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestApp } from '../../src/testing/app.js';

// As in production (the --import preload), the OpenTelemetry SDK starts before Nest and Express are first
// loaded, so the test app is imported afterwards. server-core's own tests cover the metrics in depth.
describe('admin-api platform middleware', () => {
  let otel: OtelHandle;
  let app: TestApp;

  beforeAll(async () => {
    otel = await bootstrapTelemetry({ serviceName: 'admin-api', env: {} });
    const { createTestApp } = await import('../../src/testing/app.js');
    app = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await otel?.shutdown();
  }, 30_000);

  it('Should set security headers on API responses', async () => {
    const res = await app.http().get('/api/auth/me');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('Should serve Prometheus metrics named for admin-api, outside /api and without a session', async () => {
    await app.http().get('/api/auth/me');
    const res = await app.http().get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.text).toMatch(/^http_server_request_duration_count\{.*http_route="\/api\/auth\/me"/m);
    const targetInfo = res.text.split('\n').find((line) => line.startsWith('target_info{'));
    expect(targetInfo).toContain('service_name="admin-api"');
  });
});
