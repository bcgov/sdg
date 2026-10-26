import { AuthError } from '@repo/auth';
import { identities, principals } from '@repo/portal-database';
import type supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PrincipalsService } from '../principals/principals.service.js';
import { createTestApp, resetOidcStub, TEST_ENV, type TestApp } from '../testing/app.js';

const APP = TEST_ENV.APP_URL;

const sessionId = (res: supertest.Response): string | undefined => res.headers['set-cookie']?.[0]?.split(';')[0];

describe('AuthController', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    resetOidcStub(t.oidc);
    vi.restoreAllMocks();
    await t.database.db.delete(principals);
  });

  /** Runs /login then /callback on one cookie jar; returns the agent and the callback response. */
  async function signIn(returnTo = '/reports?year=2026'): Promise<{ agent: supertest.Agent; res: supertest.Response }> {
    const agent = t.http();
    await agent.get('/api/auth/login').query({ returnTo });
    const res = await agent.get('/api/auth/callback').query({ code: 'code-1', state: 'state-1' });
    return { agent, res };
  }

  describe('GET /api/auth/login', () => {
    it('redirects 302 to Keycloak and stores the pending authorization', async () => {
      const agent = t.http();
      const res = await agent.get('/api/auth/login').query({ returnTo: '/reports' });
      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe(
        `${TEST_ENV.KEYCLOAK_ISSUER_URL}/protocol/openid-connect/auth?state=state-1`,
      );
      expect(res.headers['set-cookie']?.[0]).toMatch(/^portal\.sid=/);
      await agent.get('/api/auth/callback').query({ code: 'c', state: 'state-1' });
      expect(t.oidc.handleCallback).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          state: 'state-1',
          nonce: 'nonce-1',
          codeVerifier: 'verifier-1',
          returnTo: '/reports',
        }),
      );
    });

    it('sanitizes returnTo with safeReturnTo', async () => {
      await Promise.all(
        ['https://evil.example.com', '//evil.example.com', '/\\evil'].map((returnTo) =>
          t.http().get('/api/auth/login').query({ returnTo }),
        ),
      );
      await t.http().get('/api/auth/login');
      expect(t.oidc.createAuthorizationRequest.mock.calls.map(([returnTo]) => returnTo)).toEqual(['/', '/', '/', '/']);
    });

    it('returns 503 when discovery fails', async () => {
      t.oidc.createAuthorizationRequest.mockRejectedValue(new AuthError('discovery_failed'));
      const res = await t.http().get('/api/auth/login');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ statusCode: 503, message: 'Login is temporarily unavailable' });
      expect(res.headers['location']).toBeUndefined();
    });
  });

  describe('GET /api/auth/callback', () => {
    it('upserts the principal, regenerates the session and redirects to returnTo', async () => {
      const agent = t.http();
      const login = await agent.get('/api/auth/login').query({ returnTo: '/reports?year=2026' });
      const res = await agent.get('/api/auth/callback').query({ code: 'code-1', state: 'state-1' });
      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe('/reports?year=2026');
      const [callbackUrl] = t.oidc.handleCallback.mock.calls[0]!;
      expect(callbackUrl.href).toBe(`${APP}/api/auth/callback?code=code-1&state=state-1`);
      expect(sessionId(res)).toBeDefined();
      expect(sessionId(res)).not.toBe(sessionId(login));
      const [principal] = await t.database.db.select().from(principals);
      expect(principal).toMatchObject({ displayName: 'Ada Lovelace', email: 'ada@example.com' });
      expect(await t.database.db.$count(identities)).toBe(1);
    });

    it('redirects to /?authError=invalid_state without a pending authorization', async () => {
      const res = await t.http().get('/api/auth/callback').query({ code: 'c', state: 'forged' });
      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe(`${APP}/?authError=invalid_state`);
      expect(t.oidc.handleCallback).not.toHaveBeenCalled();
    });

    it('redirects to /?authError=access_denied for an IdP access_denied', async () => {
      t.oidc.handleCallback.mockRejectedValue(new AuthError('callback_failed', { detail: 'access_denied' }));
      const { agent, res } = await signIn();
      expect(res.headers['location']).toBe(`${APP}/?authError=access_denied`);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
      // The pending authorization is consumed even on failure.
      const replay = await agent.get('/api/auth/callback').query({ code: 'c', state: 'state-1' });
      expect(replay.headers['location']).toBe(`${APP}/?authError=invalid_state`);
    });

    it('redirects to /?authError=login_failed and creates no session when the upsert fails', async () => {
      vi.spyOn(PrincipalsService.prototype, 'upsertFromLogin').mockRejectedValue(new Error('database down'));
      const { agent, res } = await signIn();
      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe(`${APP}/?authError=login_failed`);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
      expect(await t.database.db.$count(principals)).toBe(0);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 200 { id, name, email } for an authenticated session', async () => {
      const { agent } = await signIn();
      const res = await agent.get('/api/auth/me');
      const [principal] = await t.database.db.select().from(principals);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: principal!.id, name: 'Ada Lovelace', email: 'ada@example.com' });
      expect(JSON.stringify(res.body)).not.toMatch(/token/i);
    });

    it('returns 401 without a session', async () => {
      const res = await t.http().get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('destroys the session, clears the cookie and returns the end-session URL', async () => {
      const { agent } = await signIn();
      const res = await agent.post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body.redirectUrl).toBe(
        `${TEST_ENV.KEYCLOAK_ISSUER_URL}/protocol/openid-connect/logout?id_token_hint=id-token`,
      );
      expect(t.oidc.buildEndSessionUrl).toHaveBeenCalledWith('id-token');
      expect(res.headers['set-cookie']?.[0]).toMatch(/^portal\.sid=;.*Expires=Thu, 01 Jan 1970/);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
    });

    it('returns redirectUrl APP_URL/ without a session', async () => {
      const res = await t.http().post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ redirectUrl: `${APP}/` });
      expect(t.oidc.buildEndSessionUrl).not.toHaveBeenCalled();
    });
  });
});
