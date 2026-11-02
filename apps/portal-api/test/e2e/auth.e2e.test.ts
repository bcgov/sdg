import { AuthError } from '@repo/auth';
import { identities, principals } from '@repo/portal-database';
import type supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PrincipalsService } from '../../src/principals/principals.service.js';
import { createTestApp, resetOidcStub, TEST_ENV, type TestApp } from '../../src/testing/app.js';

const APP = TEST_ENV.APP_URL;

const sessionId = (res: supertest.Response): string | undefined => res.headers['set-cookie']?.[0]?.split(';')[0];

describe('AuthController Integration Test Suite', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    resetOidcStub(app.oidc);
    vi.restoreAllMocks();
    await app.database.db.delete(principals);
  });

  /** Runs /login then /callback on one cookie jar; returns the agent and the callback response. */
  async function signIn(returnTo = '/reports?year=2026'): Promise<{ agent: supertest.Agent; res: supertest.Response }> {
    const agent = app.http();
    await agent.get('/api/auth/login').query({ returnTo });
    const res = await agent.get('/api/auth/callback').query({ code: 'code-1', state: 'state-1' });
    return { agent, res };
  }

  describe('GET /api/auth/login', () => {
    it('Should redirect 302 to Keycloak and stores the pending authorization', async () => {
      const agent = app.http();
      const res = await agent.get('/api/auth/login').query({ returnTo: '/reports' });
      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe(
        `${TEST_ENV.KEYCLOAK_ISSUER_URL}/protocol/openid-connect/auth?state=state-1`,
      );
      expect(res.headers['set-cookie']?.[0]).toMatch(/^portal\.sid=/);
      await agent.get('/api/auth/callback').query({ code: 'c', state: 'state-1' });
      expect(app.oidc.handleCallback).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          state: 'state-1',
          nonce: 'nonce-1',
          codeVerifier: 'verifier-1',
          returnTo: '/reports',
        }),
      );
    });

    it('Should sanitize returnTo with safeReturnTo', async () => {
      await Promise.all(
        ['https://evil.example.com', '//evil.example.com', '/\\evil'].map((returnTo) =>
          app.http().get('/api/auth/login').query({ returnTo }),
        ),
      );
      await app.http().get('/api/auth/login');
      expect(app.oidc.createAuthorizationRequest.mock.calls.map(([returnTo]) => returnTo)).toEqual([
        '/',
        '/',
        '/',
        '/',
      ]);
    });

    it('Should return 503 when discovery fails', async () => {
      app.oidc.createAuthorizationRequest.mockRejectedValue(new AuthError('discovery_failed'));
      const res = await app.http().get('/api/auth/login');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        statusCode: 503,
        message: 'Login is temporarily unavailable',
      });
      expect(res.headers['location']).toBeUndefined();
    });

    it('Should handle non-Error throw when discovery fails', async () => {
      app.oidc.createAuthorizationRequest.mockRejectedValue('string error');
      const res = await app.http().get('/api/auth/login');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        statusCode: 503,
        message: 'Login is temporarily unavailable',
      });
    });
  });

  describe('GET /api/auth/callback', () => {
    it('Should upsert the principal, regenerate the session and redirects to returnTo', async () => {
      const agent = app.http();
      const login = await agent.get('/api/auth/login').query({ returnTo: '/reports?year=2026' });
      const res = await agent.get('/api/auth/callback').query({ code: 'code-1', state: 'state-1' });
      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe('/reports?year=2026');
      const [callbackUrl] = app.oidc.handleCallback.mock.calls[0]!;
      expect(callbackUrl.href).toBe(`${APP}/api/auth/callback?code=code-1&state=state-1`);
      expect(sessionId(res)).toBeDefined();
      expect(sessionId(res)).not.toBe(sessionId(login));
      const [principal] = await app.database.db.select().from(principals);
      expect(principal).toMatchObject({
        displayName: 'Ada Lovelace',
        email: 'ada@example.com',
      });
      expect(await app.database.db.$count(identities)).toBe(1);
    });

    it('Should redirect to /?authError=invalid_state without a pending authorization', async () => {
      const res = await app.http().get('/api/auth/callback').query({ code: 'c', state: 'forged' });
      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe(`${APP}/?authError=invalid_state`);
      expect(app.oidc.handleCallback).not.toHaveBeenCalled();
    });

    it('Should redirect to /?authError=access_denied for an IdP access_denied', async () => {
      app.oidc.handleCallback.mockRejectedValue(new AuthError('callback_failed', { detail: 'access_denied' }));
      const { agent, res } = await signIn();
      expect(res.headers['location']).toBe(`${APP}/?authError=access_denied`);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
      // The pending authorization is consumed even on failure.
      const replay = await agent.get('/api/auth/callback').query({ code: 'c', state: 'state-1' });
      expect(replay.headers['location']).toBe(`${APP}/?authError=invalid_state`);
    });

    it('Should redirect to /?authError=login_failed and creates no session when the upsert fails', async () => {
      vi.spyOn(PrincipalsService.prototype, 'upsertFromLogin').mockRejectedValue(new Error('database down'));
      const { agent, res } = await signIn();
      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe(`${APP}/?authError=login_failed`);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
      expect(await app.database.db.$count(principals)).toBe(0);
    });

    it('Should redirect to /?authError=invalid_state when handleCallback fails with invalid_state code', async () => {
      app.oidc.handleCallback.mockRejectedValue(new AuthError('invalid_state'));
      const { res } = await signIn();
      expect(res.headers['location']).toBe(`${APP}/?authError=invalid_state`);
    });

    it('Should redirect to /?authError=login_failed when handleCallback fails with non-access_denied detail', async () => {
      app.oidc.handleCallback.mockRejectedValue(new AuthError('callback_failed', { detail: 'server_error' }));
      const { res } = await signIn();
      expect(res.headers['location']).toBe(`${APP}/?authError=login_failed`);
    });

    it('Should redirect to /?authError=login_failed when handleCallback throws a non-Error', async () => {
      app.oidc.handleCallback.mockRejectedValue('string callback failure');
      const { res } = await signIn();
      expect(res.headers['location']).toBe(`${APP}/?authError=login_failed`);
    });
  });

  describe('GET /api/auth/me', () => {
    it('Should return 200 { id, name, email } for an authenticated session', async () => {
      const { agent } = await signIn();
      const res = await agent.get('/api/auth/me');
      const [principal] = await app.database.db.select().from(principals);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: principal!.id,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/token/i);
    });

    it('Should return 401 without a session', async () => {
      const res = await app.http().get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('Should destroy the session, clears the cookie and returns the end-session URL', async () => {
      const { agent } = await signIn();
      const res = await agent.post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body.redirectUrl).toBe(
        `${TEST_ENV.KEYCLOAK_ISSUER_URL}/protocol/openid-connect/logout?id_token_hint=id-token`,
      );
      expect(app.oidc.buildEndSessionUrl).toHaveBeenCalledWith('id-token');
      expect(res.headers['set-cookie']?.[0]).toMatch(/^portal\.sid=;.*Expires=Thu, 01 Jan 1970/);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
    });

    it('Should fallback to APP_URL/ and destroy session when buildEndSessionUrl throws Error', async () => {
      const { agent } = await signIn();
      app.oidc.buildEndSessionUrl.mockRejectedValue(new Error('Keycloak end-session unavailable'));
      const res = await agent.post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ redirectUrl: `${APP}/` });
      expect(app.oidc.buildEndSessionUrl).toHaveBeenCalledWith('id-token');
      expect(res.headers['set-cookie']?.[0]).toMatch(/^portal\.sid=;.*Expires=Thu, 01 Jan 1970/);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
    });

    it('Should fallback to APP_URL/ when buildEndSessionUrl throws a non-Error', async () => {
      const { agent } = await signIn();
      app.oidc.buildEndSessionUrl.mockRejectedValue('network failure string');
      const res = await agent.post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ redirectUrl: `${APP}/` });
      expect(app.oidc.buildEndSessionUrl).toHaveBeenCalledWith('id-token');
      expect(res.headers['set-cookie']?.[0]).toMatch(/^portal\.sid=;.*Expires=Thu, 01 Jan 1970/);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
    });

    it('Should return redirectUrl APP_URL/ without a session', async () => {
      const res = await app.http().post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ redirectUrl: `${APP}/` });
      expect(app.oidc.buildEndSessionUrl).not.toHaveBeenCalled();
    });
  });
});
