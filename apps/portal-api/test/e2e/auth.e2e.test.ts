import { sessions } from '@repo/bff-core';
import { CORE_API_PROFILE, json, PRINCIPAL_ID, unreachable } from '@repo/bff-core/testing';
import { isNull } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_URL, authorize, createTestApp, ID_TOKEN_CLAIMS, signIn, type TestApp } from '../../src/testing/app.js';

const EXPIRED_COOKIE = /^portal\.sid=;.*Expires=Thu, 01 Jan 1970/;

describe('portal-api sign-in, current user and sign-out (F1, R11, R12)', () => {
  let t: TestApp;

  const liveSessions = () => t.database.db.$count(sessions, isNull(sessions.destroyedAt));

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    t.coreApi.reset();
    await t.database.db.delete(sessions);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/auth/login', () => {
    it('Should redirect to Keycloak with the portal client and the APP_URL callback', async () => {
      const res = await t.http().get('/api/auth/login').query({ returnTo: '/reports' });
      expect(res.status).toBe(302);
      const location = new URL(res.headers['location'] ?? '');
      expect(`${location.origin}${location.pathname}`).toBe(`${t.idp.issuer}/auth`);
      expect(location.searchParams.get('client_id')).toBe('portal');
      expect(location.searchParams.get('redirect_uri')).toBe(`${APP_URL}/api/auth/callback`);
      expect(res.headers['set-cookie']?.[0]).toMatch(/^portal\.sid=s%3A.*; Path=\/; .*HttpOnly; SameSite=Lax$/);
    });

    it('Should sanitize returnTo to a relative path', async () => {
      const create = vi.spyOn(t.oidc, 'createAuthorizationRequest');
      await t.http().get('/api/auth/login').query({ returnTo: 'https://evil.example.com' });
      await t.http().get('/api/auth/login?returnTo=/a&returnTo=/b');
      expect(create.mock.calls.map(([returnTo]) => returnTo)).toEqual(['/', '/']);
    });

    it('Should answer 503 when Keycloak discovery fails', async () => {
      vi.spyOn(t.oidc, 'createAuthorizationRequest').mockRejectedValue(new Error('getaddrinfo ENOTFOUND keycloak'));
      const res = await t.http().get('/api/auth/login');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ statusCode: 503, message: 'Login is temporarily unavailable' });
    });
  });

  describe('GET /api/auth/callback', () => {
    it('Should upsert the principal through core-api with the fresh access token, then set portal.sid', async () => {
      const { agent, res } = await signIn(t, '/reports?year=2026');
      expect(res.headers['location']).toBe('/reports?year=2026');
      expect(res.headers['set-cookie']?.[0]).toMatch(/^portal\.sid=s%3A.*; Path=\/; .*HttpOnly; SameSite=Lax$/);
      expect(t.coreApi.received).toEqual([
        expect.objectContaining({
          method: 'POST',
          url: '/internal/principals/login',
          headers: expect.objectContaining({ authorization: 'Bearer access-token' }),
        }),
      ]);
      expect(t.coreApi.received[0]?.headers.cookie).toBeUndefined();
      expect(await liveSessions()).toBe(1);

      const me = await agent.get('/api/auth/me');
      expect(me.status).toBe(200);
      // The name core-api read from Keycloak userinfo, not the ID token's.
      expect(me.body).toEqual({ id: PRINCIPAL_ID, ...CORE_API_PROFILE });
      expect(me.body.name).not.toBe(ID_TOKEN_CLAIMS.name);
      expect(JSON.stringify(me.body)).not.toMatch(/token/i);
    });

    it.each([
      ['is down', unreachable],
      ['answers 503', json(503, { statusCode: 503, message: 'Sign-in is temporarily unavailable' })],
    ])('Should redirect with authError=unavailable and keep no session when core-api %s (AE7)', async (_, respond) => {
      t.coreApi.respond = respond;
      const agent = t.http();
      const callback = await authorize(t, agent);
      const res = await agent.get('/api/auth/callback').query(callback);
      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe(`${APP_URL}/?authError=unavailable`);
      expect(res.headers['set-cookie']?.[0]).toMatch(EXPIRED_COOKIE);
      expect(await liveSessions()).toBe(0);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
    });

    it('Should redirect with authError=access_denied and keep no session when core-api refuses (403)', async () => {
      t.coreApi.respond = json(403, { statusCode: 403, message: 'Forbidden' });
      const agent = t.http();
      const callback = await authorize(t, agent);
      const res = await agent.get('/api/auth/callback').query(callback);
      expect(res.headers['location']).toBe(`${APP_URL}/?authError=access_denied`);
      expect(await liveSessions()).toBe(0);
    });

    it('Should redirect with authError=invalid_state without a pending authorization, never calling core-api', async () => {
      const res = await t.http().get('/api/auth/callback').query({ code: 'c', state: 'forged' });
      expect(res.headers['location']).toBe(`${APP_URL}/?authError=invalid_state`);
      expect(t.coreApi.received).toEqual([]);
    });
  });

  describe('GET /api/auth/me', () => {
    it('Should answer 401 without a session and set no cookie', async () => {
      const res = await t.http().get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('Should answer from the session alone while core-api is down', async () => {
      const { agent } = await signIn(t);
      t.coreApi.reset();
      t.coreApi.respond = unreachable;
      expect((await agent.get('/api/auth/me')).status).toBe(200);
      expect(t.coreApi.received).toEqual([]);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('Should end the session row, clear the cookie and return the Keycloak end-session URL', async () => {
      const { agent } = await signIn(t);
      const res = await agent.post('/api/auth/logout');
      expect(res.status).toBe(200);
      const redirect = new URL(res.body.redirectUrl);
      expect(`${redirect.origin}${redirect.pathname}`).toBe(`${t.idp.issuer}/logout`);
      expect(redirect.searchParams.get('id_token_hint')).toEqual(expect.any(String));
      expect(redirect.searchParams.get('post_logout_redirect_uri')).toBe(`${APP_URL}/`);
      expect(res.headers['set-cookie']?.[0]).toMatch(EXPIRED_COOKIE);
      expect(await liveSessions()).toBe(0);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
    });

    it('Should return APP_URL/ without a session', async () => {
      const res = await t.http().post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ redirectUrl: `${APP_URL}/` });
    });

    it('Should refuse a logout posted from another origin (R31)', async () => {
      const { agent } = await signIn(t);
      const res = await agent.post('/api/auth/logout').set('origin', 'https://evil.example.com');
      expect(res.status).toBe(403);
      expect((await agent.get('/api/auth/me')).status).toBe(200);
    });
  });
});
