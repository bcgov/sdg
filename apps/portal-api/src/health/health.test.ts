import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';

describe('health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(() => {
    t.oidc.discover.mockReset().mockResolvedValue(undefined);
  });

  describe('GET /healthz/live', () => {
    it('returns 200 status ok without touching dependencies', async () => {
      const res = await t.http().get('/healthz/live');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', info: {}, error: {}, details: {} });
      expect(t.oidc.discover).not.toHaveBeenCalled();
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('GET /healthz/ready', () => {
    it('returns 200 with database and keycloak up', async () => {
      const res = await t.http().get('/healthz/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.info).toMatchObject({
        database: { status: 'up' },
        keycloak: { status: 'up' },
      });
      expect(t.oidc.discover).toHaveBeenCalledTimes(1);
    });

    it('returns 503 with the failing check marked down', async () => {
      t.oidc.discover.mockRejectedValue(new Error('Keycloak unreachable'));
      const res = await t.http().get('/healthz/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('error');
      expect(res.body.error).toMatchObject({ keycloak: { status: 'down' } });
      expect(res.body.info).toMatchObject({ database: { status: 'up' } });
    });
  });
});
