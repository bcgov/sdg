import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../../src/testing/app.js';

describe('Admin API App Integration Test Suite', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  describe('routing', () => {
    it('Should serve health outside the /api prefix', async () => {
      expect((await t.http().get('/healthz/live')).status).toBe(200);
      expect((await t.http().get('/healthz/ready')).status).toBe(200);
      expect((await t.http().get('/api/healthz/live')).status).toBe(404);
    });

    it('Should serve auth under /api without a version segment', async () => {
      expect((await t.http().get('/api/auth/me')).status).toBe(401);
      expect((await t.http().get('/api/auth/login')).status).toBe(302);
      expect((await t.http().get('/auth/me')).status).toBe(404);
    });

    it('Should return 404 for /api/v1/auth/me and /healthz under /api', async () => {
      expect((await t.http().get('/api/v1/auth/me')).status).toBe(404);
      expect((await t.http().get('/api/v1/healthz/live')).status).toBe(404);
      expect((await t.http().get('/api/healthz/ready')).status).toBe(404);
      expect((await t.http().get('/api/unknown')).headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('session cookie', () => {
    it('Should set admin.sid HttpOnly SameSite=Lax only after /login', async () => {
      const agent = t.http();
      expect((await agent.get('/api/auth/me')).headers['set-cookie']).toBeUndefined();
      const cookie = (await agent.get('/api/auth/login')).headers['set-cookie']?.[0] ?? '';
      expect(cookie).toMatch(/^admin\.sid=/);
      expect(cookie).toMatch(/; HttpOnly/);
      expect(cookie).toMatch(/; SameSite=Lax/);
      expect(cookie).toMatch(/; Path=\//);
      expect(cookie).not.toMatch(/; Secure/);
    });
  });
});
