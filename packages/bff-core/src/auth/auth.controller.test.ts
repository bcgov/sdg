import { Logger } from '@nestjs/common';
import { startFakeIdp, type FakeIdp } from '@repo/auth/testing';
import { isNull } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoginRefusal } from '../nestjs/bff.options.js';
import { sessions } from '../session/sessions.schema.js';
import { APP_URL, createBffTestApp, signIn, type BffTestApp } from '../test-support/bff-app.js';
import { createTestSessionDatabase, type TestSessionDatabase } from '../test-support/database.js';
import {
  CORE_API_PROFILE,
  json,
  PRINCIPAL_ID,
  startCoreApiStub,
  unreachable,
  type CoreApiStub,
} from '../testing/core-api-stub.js';

describe('AuthController', () => {
  let idp: FakeIdp;
  let coreApi: CoreApiStub;
  let database: TestSessionDatabase;
  let t: BffTestApp;
  const onLoginRefused = vi.fn<LoginRefusal>();

  const liveSessions = () => database.db.$count(sessions, isNull(sessions.destroyedAt));

  beforeAll(async () => {
    [idp, coreApi, database] = await Promise.all([startFakeIdp(), startCoreApiStub(), createTestSessionDatabase()]);
    t = await createBffTestApp({ idp, coreApi, database, overrides: { onLoginRefused } });
  }, 60_000);

  afterAll(async () => {
    await t.close();
    await Promise.all([idp.close(), coreApi.close(), database.close()]);
  });

  beforeEach(async () => {
    coreApi.reset();
    onLoginRefused.mockReset().mockResolvedValue(`${APP_URL}/not-authorized`);
    await database.db.delete(sessions);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/auth/login', () => {
    it('redirects to Keycloak with PKCE and keeps the pending authorization in a brand-new session', async () => {
      const res = await t.http().get('/api/auth/login').query({ returnTo: '/reports' });
      expect(res.status).toBe(302);
      const location = new URL(res.headers['location'] ?? '');
      expect(`${location.origin}${location.pathname}`).toBe(`${idp.issuer}/auth`);
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      expect(location.searchParams.get('redirect_uri')).toBe(`${APP_URL}/api/auth/callback`);
      expect(res.headers['set-cookie']?.[0]).toMatch(/^portal\.sid=.*HttpOnly; SameSite=Lax/);
      expect(await liveSessions()).toBe(1);
    });

    it('answers 503 and logs the cause when Keycloak discovery fails', async () => {
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      vi.spyOn(t.oidc, 'createAuthorizationRequest').mockRejectedValue(new Error('getaddrinfo ENOTFOUND keycloak'));
      const res = await t.http().get('/api/auth/login');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ statusCode: 503, message: 'Login is temporarily unavailable' });
      expect(error).toHaveBeenCalledWith({
        msg: 'Could not start login',
        error: expect.objectContaining({ message: 'getaddrinfo ENOTFOUND keycloak' }),
      });
    });
  });

  describe('GET /api/auth/callback', () => {
    it('upserts the principal through core-api with the fresh access token, then signs in', async () => {
      const { agent, res } = await signIn(t, idp);
      expect(res.headers['location']).toBe('/after');
      expect(coreApi.received).toEqual([
        expect.objectContaining({
          method: 'POST',
          url: '/internal/principals/login',
          headers: expect.objectContaining({ authorization: 'Bearer access-token' }),
        }),
      ]);
      const me = await agent.get('/api/auth/me');
      expect(me.status).toBe(200);
      // The profile core-api read from Keycloak userinfo, not the ID token's 'Ada Lovelace'.
      expect(me.body).toEqual({ id: PRINCIPAL_ID, ...CORE_API_PROFILE });
      expect(await liveSessions()).toBe(1);
    });

    it.each([
      ['no profile', {}, { name: 'Ada Lovelace', email: 'ada@example.com' }],
      ['only a name', { name: 'Ada K.' }, { name: 'Ada K.', email: 'ada@example.com' }],
      ['a null email', { email: null }, { name: 'Ada Lovelace', email: null }],
    ])('falls back to the ID token claims core-api omits (%s)', async (_case, profile, expected) => {
      coreApi.respond = json(200, { principalId: PRINCIPAL_ID, ...profile });
      const { agent } = await signIn(t, idp);
      expect((await agent.get('/api/auth/me')).body).toEqual({ id: PRINCIPAL_ID, ...expected });
    });

    it.each([
      ['answers 503', json(503, { message: 'unavailable' })],
      ['is unreachable', unreachable],
    ])('redirects with authError=unavailable and keeps no session when core-api %s', async (_case, respond) => {
      coreApi.respond = respond;
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const agent = t.http();
      const callback = await completeCallback(agent);
      expect(callback.status).toBe(302);
      expect(callback.headers['location']).toBe(`${APP_URL}/?authError=unavailable`);
      expect(callback.headers['set-cookie']?.[0]).toMatch(/^portal\.sid=;.*Expires=Thu, 01 Jan 1970/);
      expect(await liveSessions()).toBe(0);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ msg: 'core-api unavailable at login' }));
    });

    it('runs the refusal hook when core-api answers 403, and keeps no session', async () => {
      coreApi.respond = json(403, { message: 'Forbidden' });
      const agent = t.http();
      const res = await completeCallback(agent);
      expect(res.headers['location']).toBe(`${APP_URL}/not-authorized`);
      expect(onLoginRefused).toHaveBeenCalledWith(
        expect.objectContaining({ tokens: expect.objectContaining({ refreshToken: 'refresh-token' }) }),
      );
      expect(await liveSessions()).toBe(0);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
    });

    it.each([
      ['an unexpected status', json(500, { message: 'boom' })],
      ['a body without a principal id', json(200, { id: 'not-a-principal' })],
    ])('redirects with authError=login_failed when core-api answers %s', async (_case, respond) => {
      coreApi.respond = respond;
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const res = await completeCallback(t.http());
      expect(res.headers['location']).toBe(`${APP_URL}/?authError=login_failed`);
      expect(await liveSessions()).toBe(0);
    });

    it('redirects with authError=invalid_state without a pending authorization, and consumes it on failure', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const forged = await t.http().get('/api/auth/callback').query({ code: 'c', state: 'forged' });
      expect(forged.headers['location']).toBe(`${APP_URL}/?authError=invalid_state`);

      const agent = t.http();
      await agent.get('/api/auth/login');
      const failed = await agent.get('/api/auth/callback').query({ error: 'access_denied', state: 'wrong' });
      expect(failed.headers['location']).toMatch(/authError=(invalid_state|access_denied)$/);
      const replay = await agent.get('/api/auth/callback').query({ code: 'c', state: 'wrong' });
      expect(replay.headers['location']).toBe(`${APP_URL}/?authError=invalid_state`);
      expect(coreApi.received).toEqual([]);
    });
  });

  describe('GET /api/auth/me', () => {
    it('answers from the session alone, without core-api or Keycloak', async () => {
      const { agent } = await signIn(t, idp);
      coreApi.reset();
      coreApi.respond = unreachable;
      const refresh = vi.spyOn(t.oidc, 'refresh');
      expect((await agent.get('/api/auth/me')).status).toBe(200);
      expect(coreApi.received).toEqual([]);
      expect(refresh).not.toHaveBeenCalled();
    });

    it('answers 401 without a session and sets no cookie', async () => {
      const res = await t.http().get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('ends the session, clears the cookie and returns the Keycloak end-session URL', async () => {
      const { agent } = await signIn(t, idp);
      const res = await agent.post('/api/auth/logout');
      expect(res.status).toBe(200);
      const redirect = new URL(res.body.redirectUrl);
      expect(`${redirect.origin}${redirect.pathname}`).toBe(`${idp.issuer}/logout`);
      expect(redirect.searchParams.get('id_token_hint')).toEqual(expect.any(String));
      expect(res.headers['set-cookie']?.[0]).toMatch(/^portal\.sid=;.*Expires=Thu, 01 Jan 1970/);
      expect(await liveSessions()).toBe(0);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
    });

    it('returns the app origin without a session', async () => {
      const res = await t.http().post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ redirectUrl: `${APP_URL}/` });
    });
  });

  /** /login, then /callback with a code the fake IdP will redeem; returns the callback response. */
  async function completeCallback(agent: ReturnType<BffTestApp['http']>) {
    const login = await agent.get('/api/auth/login');
    const location = new URL(login.headers['location'] ?? '');
    const code = idp.issueCode({
      nonce: location.searchParams.get('nonce') ?? '',
      codeChallenge: location.searchParams.get('code_challenge') ?? '',
      claims: { sub: 'user-1', name: 'Ada Lovelace' },
    });
    return agent.get('/api/auth/callback').query({ code, state: location.searchParams.get('state') ?? '' });
  }
});
