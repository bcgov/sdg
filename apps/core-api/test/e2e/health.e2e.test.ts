import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../../src/testing/app.js';

describe('Health Integration Test Suite', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(() => t.idp.reset());

  it('Should answer /healthz/live without touching dependencies', async () => {
    const res = await t.http().get('/healthz/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', info: {}, error: {}, details: {} });
  });

  it('Should check only its own database on /healthz/ready', async () => {
    const res = await t.http().get('/healthz/ready');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.info)).toEqual(['database']);
    expect(res.body.info.database.status).toBe('up');
  });

  it('Should stay ready while Keycloak is unreachable', async () => {
    t.idp.idp.failDiscovery = true;
    t.idp.idp.failJwks = true;
    const before = t.idp.idp.discoveryRequests;
    expect((await t.http().get('/healthz/ready')).status).toBe(200);
    expect(t.idp.idp.discoveryRequests).toBe(before);
  });

  it('Should serve /metrics outside /api', async () => {
    expect((await t.http().get('/metrics')).status).toBe(200);
  });

  it('Should describe the internal and shared routes in its OpenAPI document', async () => {
    const res = await t.http().get('/api/docs-json');
    expect(res.status).toBe(200);
    expect(res.body.info.title).toBe('Core API');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/internal/principals/login', '/api/v1/shared/me']),
    );
    expect(res.body.components.securitySchemes).toHaveProperty('bearer');
  });
});
