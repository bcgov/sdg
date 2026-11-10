import { Logger } from '@nestjs/common';
import { AuthError } from '@repo/auth';
import { sessions } from '@repo/bff-core';
import { json, PRINCIPAL_ID } from '@repo/bff-core/testing';
import { isNull } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_URL, authorize, createTestApp, signIn, TEST_ENV, type TestApp } from '../../src/testing/app.js';

const EXPIRED_COOKIE = /^admin\.sid=;.*Expires=Thu, 01 Jan 1970/;
const NOT_AUTHORIZED = `${APP_URL}/not-authorized`;
/** core-api's refusal of an admin-client token without the admin client role. */
const refused = json(403, { statusCode: 403, message: 'Forbidden' });

describe('admin-api sign-in (F2, R7, R14)', () => {
  let t: TestApp;

  const liveSessions = () => t.database.db.$count(sessions, isNull(sessions.destroyedAt));

  /** Completes a Keycloak login on a fresh client and returns it with the callback response. */
  async function callback() {
    const agent = t.http();
    const query = await authorize(t, agent);
    return { agent, res: await agent.get('/api/auth/callback').query(query) };
  }

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

  it('Should redirect to Keycloak with the admin client and the admin host callback', async () => {
    const res = await t.http().get('/api/auth/login');
    expect(res.status).toBe(302);
    const location = new URL(res.headers['location'] ?? '');
    expect(location.searchParams.get('client_id')).toBe(TEST_ENV.KEYCLOAK_CLIENT_ID);
    expect(location.searchParams.get('redirect_uri')).toBe(`${APP_URL}/api/auth/callback`);
    expect(res.headers['set-cookie']?.[0]).toMatch(/^admin\.sid=s%3A.*; Path=\/; .*HttpOnly; SameSite=Lax$/);
  });

  it('Should set admin.sid once core-api accepts the administrator', async () => {
    const endSession = vi.spyOn(t.oidc, 'endSession');
    const { agent, res } = await signIn(t, '/service-clients');
    expect(res.headers['location']).toBe('/service-clients');
    expect(res.headers['set-cookie']?.[0]).toMatch(/^admin\.sid=s%3A.*; Path=\/; .*HttpOnly; SameSite=Lax$/);
    expect(t.coreApi.received).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: '/internal/principals/login',
        headers: expect.objectContaining({ authorization: 'Bearer access-token' }),
      }),
    ]);
    expect(await liveSessions()).toBe(1);
    expect((await agent.get('/api/auth/me')).body).toMatchObject({ id: PRINCIPAL_ID });
    expect(endSession).not.toHaveBeenCalled();
  });

  describe('when core-api refuses the token (no admin client role; KTD6, AE1)', () => {
    it('Should end the Keycloak session with the fresh tokens and send the browser to /not-authorized, keeping no session', async () => {
      t.coreApi.respond = refused;
      const endSession = vi.spyOn(t.oidc, 'endSession').mockResolvedValue();
      const { agent, res } = await callback();
      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe(NOT_AUTHORIZED);
      expect(endSession).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
      );
      expect(res.headers['set-cookie']).toEqual([expect.stringMatching(EXPIRED_COOKIE)]);
      expect(await liveSessions()).toBe(0);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
    });

    it('Should still send the browser to /not-authorized when Keycloak cannot end the session, logging why', async () => {
      t.coreApi.respond = refused;
      vi.spyOn(t.oidc, 'endSession').mockRejectedValue(
        new AuthError('end_session_failed', { detail: 'invalid_grant' }),
      );
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { res } = await callback();
      expect(res.headers['location']).toBe(NOT_AUTHORIZED);
      expect(await liveSessions()).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'Could not end the Keycloak session of a refused sign-in',
          error: expect.objectContaining({ type: 'AuthError', code: 'end_session_failed', detail: 'invalid_grant' }),
        }),
      );
    });
  });

  it('Should redirect with authError=unavailable, never ending the Keycloak session, when core-api answers 503', async () => {
    t.coreApi.respond = json(503, { statusCode: 503, message: 'Service Unavailable' });
    const endSession = vi.spyOn(t.oidc, 'endSession');
    const { res } = await callback();
    expect(res.headers['location']).toBe(`${APP_URL}/?authError=unavailable`);
    expect(endSession).not.toHaveBeenCalled();
    expect(await liveSessions()).toBe(0);
  });
});
