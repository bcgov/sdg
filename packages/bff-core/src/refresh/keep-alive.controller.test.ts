import { Logger } from '@nestjs/common';
import { AuthError } from '@repo/auth';
import { startFakeIdp, type FakeIdp } from '@repo/auth/testing';
import { eq } from 'drizzle-orm';
import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessions } from '../session/sessions.schema.js';
import { createBffTestApp, setTokens, signIn, type BffTestApp } from '../test-support/bff-app.js';
import { createTestSessionDatabase, type TestSessionDatabase } from '../test-support/database.js';
import { startCoreApiStub, type CoreApiStub } from '../testing/core-api-stub.js';
import { KEEP_ALIVE_MIN_AGE_MS } from './token-refresh.service.js';

const KEEP_ALIVE = '/api/auth/keep-alive';
const CLEARED_COOKIE = /^portal\.sid=;.*Expires=Thu, 01 Jan 1970/;

describe('POST /api/auth/keep-alive', () => {
  let idp: FakeIdp;
  let coreApi: CoreApiStub;
  let database: TestSessionDatabase;
  let t: BffTestApp;

  const rowOf = async (sid: string) => (await database.db.select().from(sessions).where(eq(sessions.sid, sid)))[0];

  /** Signs in with tokens obtained `age` ms ago and a refresh token the IdP will honour. */
  async function sessionAged(age: number) {
    const signedIn = await signIn(t, idp);
    const tokens = await setTokens(t, signedIn.sid, {
      obtainedAt: Date.now() - age,
      expiresAt: Date.now() + 240_000,
      refreshExpiresAt: Date.now() - age + 1_800_000,
      refreshToken: idp.issueRefreshToken(),
    });
    return { ...signedIn, tokens };
  }

  beforeAll(async () => {
    [idp, coreApi, database] = await Promise.all([startFakeIdp(), startCoreApiStub(), createTestSessionDatabase()]);
    t = await createBffTestApp({ idp, coreApi, database });
  }, 60_000);

  afterAll(async () => {
    await t.close();
    await Promise.all([idp.close(), coreApi.close(), database.close()]);
  });

  beforeEach(async () => {
    await database.db.delete(sessions);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers the idle deadline without asking Keycloak when the tokens are under a minute old', async () => {
    const { agent, tokens } = await sessionAged(10_000);
    const refresh = vi.spyOn(t.oidc, 'refresh');
    const res = await agent.post(KEEP_ALIVE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ idleExpiresAt: tokens.refreshExpiresAt });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('renews older tokens once, saves them and moves the idle deadline forward', async () => {
    const { agent, sid, tokens } = await sessionAged(KEEP_ALIVE_MIN_AGE_MS + 1_000);
    const refresh = vi.spyOn(t.oidc, 'refresh');
    const before = Date.now();
    const res = await agent.post(KEEP_ALIVE);
    expect(res.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(res.body.idleExpiresAt).toBeGreaterThanOrEqual(before + 1_800_000);
    const stored = (await t.store.readSession(sid))?.auth?.tokens;
    expect(stored?.refreshExpiresAt).toBe(res.body.idleExpiresAt);
    expect(stored?.refreshToken).not.toBe(tokens.refreshToken);
    // The renewed tokens are fresh: a second keep-alive right away doesn't ask Keycloak again.
    expect((await agent.post(KEEP_ALIVE)).body).toEqual(res.body);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('renews tokens saved before obtainedAt was recorded', async () => {
    const { agent, sid } = await sessionAged(0);
    await setTokens(t, sid, { obtainedAt: undefined, refreshExpiresAt: undefined });
    const refresh = vi.spyOn(t.oidc, 'refresh');
    const res = await agent.post(KEEP_ALIVE);
    expect(res.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(res.body.idleExpiresAt).toEqual(expect.any(Number));
  });

  it('keeps a session without a refresh token, with no deadline to report', async () => {
    const { agent, sid } = await sessionAged(KEEP_ALIVE_MIN_AGE_MS + 1_000);
    await setTokens(t, sid, { refreshToken: null, refreshExpiresAt: null });
    const res = await agent.post(KEEP_ALIVE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ idleExpiresAt: null });
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it('ends the session with 401 and clears the cookie when Keycloak rejects the refresh token', async () => {
    const { agent, sid } = await sessionAged(KEEP_ALIVE_MIN_AGE_MS + 1_000);
    await setTokens(t, sid, { refreshToken: 'revoked-refresh-token' });
    const res = await agent.post(KEEP_ALIVE);
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']?.[0]).toMatch(CLEARED_COOKIE);
    expect((await rowOf(sid))?.destroyedAt).toBeInstanceOf(Date);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('answers 503 and keeps the session when Keycloak is unreachable', async () => {
    const { agent, sid } = await sessionAged(KEEP_ALIVE_MIN_AGE_MS + 1_000);
    const before = await rowOf(sid);
    vi.spyOn(t.oidc, 'refresh').mockRejectedValueOnce(
      new AuthError('refresh_failed', { cause: new TypeError('fetch failed') }),
    );
    expect((await agent.post(KEEP_ALIVE)).status).toBe(503);
    expect((await rowOf(sid))?.sess).toBe(before?.sess);
    expect((await agent.post(KEEP_ALIVE)).status).toBe(200);
  });

  it('answers 401 without a session and sets no cookie', async () => {
    const res = await t.http().post(KEEP_ALIVE);
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('refuses a cross-origin request before touching the session', async () => {
    const { cookie, sid } = await sessionAged(KEEP_ALIVE_MIN_AGE_MS + 1_000);
    const refresh = vi.spyOn(t.oidc, 'refresh');
    const res = await supertest(t.app.getHttpServer())
      .post(KEEP_ALIVE)
      .set('cookie', cookie)
      .set('origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(refresh).not.toHaveBeenCalled();
    expect((await rowOf(sid))?.destroyedAt).toBeNull();
  });
});
