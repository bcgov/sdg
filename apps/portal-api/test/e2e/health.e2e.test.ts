import { unreachable } from '@repo/bff-core/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestApp, type TestApp } from '../../src/testing/app.js';

describe('Health Integration Test Suite', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  afterEach(() => {
    vi.restoreAllMocks();
    t.idp.failDiscovery = false;
    t.coreApi.reset();
  });

  describe('GET /healthz/live', () => {
    it('Should return 200 status ok without touching dependencies', async () => {
      const res = await t.http().get('/healthz/live');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', info: {}, error: {}, details: {} });
      expect(t.idp.discoveryRequests).toBe(0);
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('GET /healthz/ready', () => {
    it('Should check only its own database', async () => {
      const res = await t.http().get('/healthz/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(Object.keys(res.body.info)).toEqual(['database']);
      expect(res.body.info.database).toMatchObject({ status: 'up' });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('Should stay ready while Keycloak and core-api are down', async () => {
      t.idp.failDiscovery = true;
      t.coreApi.respond = unreachable;
      const res = await t.http().get('/healthz/ready');
      expect(res.status).toBe(200);
      expect(t.coreApi.received).toEqual([]);
    });

    it('Should return 503 with the database marked down when it fails', async () => {
      vi.spyOn(t.database.db, 'execute').mockRejectedValue(new Error('connection refused'));
      const res = await t.http().get('/healthz/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('error');
      expect(res.body.error).toMatchObject({ database: { status: 'down' } });
    });
  });
});
