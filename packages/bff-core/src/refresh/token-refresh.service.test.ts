import { Logger } from '@nestjs/common';
import { AuthError, type OidcClient } from '@repo/auth';
import { startFakeIdp, type FakeIdp } from '@repo/auth/testing';
import { eq } from 'drizzle-orm';
import type supertest from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessions } from '../session/sessions.schema.js';
import { createBffTestApp, setCookies, setTokens, signIn, type BffTestApp } from '../test-support/bff-app.js';
import { createTestSessionDatabase, type TestSessionDatabase } from '../test-support/database.js';
import { startCoreApiStub, type CoreApiStub } from '../testing/core-api-stub.js';

const FORWARDED = '/api/v1/portal/things';

/** True when the response sets a live `portal.sid` (express-session's signed `s:` value), not a cleared one. */
const isFreshCookie = (res: supertest.Response): boolean =>
  setCookies(res).some((cookie) => cookie.startsWith('portal.sid=s%3A'));

/** Holds `client.refresh` until released, then lets it reach the IdP. Resolves `started` when it is called. */
function gateRefresh(client: OidcClient) {
  const original = client.refresh.bind(client);
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const spy = vi.spyOn(client, 'refresh').mockImplementationOnce(async (current) => {
    started.resolve();
    await gate.promise;
    return original(current);
  });
  return { spy, started: started.promise, release: () => gate.resolve() };
}

describe('token refresh before forwarding (R6, AE6)', () => {
  let idp: FakeIdp;
  let coreApi: CoreApiStub;
  let database: TestSessionDatabase;
  let t: BffTestApp;
  /** A second pod on the same sessions table. */
  let otherPod: BffTestApp;

  const rowOf = async (sid: string) => (await database.db.select().from(sessions).where(eq(sessions.sid, sid)))[0];
  const bearers = () => coreApi.received.map(({ headers }) => headers.authorization);

  /** Signs in, then makes the access token expire in 10 seconds with a refresh token the IdP will honour. */
  async function expiringSession() {
    const signedIn = await signIn(t, idp);
    await setTokens(t, signedIn.sid, { expiresAt: Date.now() + 10_000, refreshToken: idp.issueRefreshToken() });
    coreApi.reset();
    return signedIn;
  }

  beforeAll(async () => {
    [idp, coreApi, database] = await Promise.all([startFakeIdp(), startCoreApiStub(), createTestSessionDatabase()]);
    [t, otherPod] = await Promise.all([
      createBffTestApp({ idp, coreApi, database }),
      createBffTestApp({ idp, coreApi, database }),
    ]);
  }, 60_000);

  afterAll(async () => {
    await Promise.all([t.close(), otherPod.close()]);
    await Promise.all([idp.close(), coreApi.close(), database.close()]);
  });

  beforeEach(async () => {
    coreApi.reset();
    await database.db.delete(sessions);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes a token 10 seconds from expiry, saves it and forwards with the new token', async () => {
    const { agent, sid } = await expiringSession();
    const refresh = vi.spyOn(t.oidc, 'refresh');
    expect((await agent.get(FORWARDED)).status).toBe(200);
    expect((await agent.get(FORWARDED)).status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(bearers()).toEqual([expect.stringMatching(/^Bearer refreshed-access-/), bearers()[0]]);
    const stored = await t.store.readSession(sid);
    expect(`Bearer ${stored?.auth?.tokens.accessToken}`).toBe(bearers()[0]);
  });

  it('does not refresh a token with more than 30 seconds left', async () => {
    const { agent, sid } = await signIn(t, idp);
    await setTokens(t, sid, { expiresAt: Date.now() + 60_000 });
    coreApi.reset();
    const refresh = vi.spyOn(t.oidc, 'refresh');
    expect((await agent.get(FORWARDED)).status).toBe(200);
    expect(refresh).not.toHaveBeenCalled();
    expect(bearers()).toEqual(['Bearer access-token']);
  });

  it('ends the session with 401 and clears the cookie when Keycloak rejects the refresh token', async () => {
    const { agent, sid } = await signIn(t, idp);
    await setTokens(t, sid, { expiresAt: Date.now() + 10_000, refreshToken: 'revoked-refresh-token' });
    coreApi.reset();
    const res = await agent.get(FORWARDED);
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']?.[0]).toMatch(/^portal\.sid=;.*Expires=Thu, 01 Jan 1970/);
    expect(coreApi.received).toEqual([]);
    expect((await rowOf(sid))?.destroyedAt).toBeInstanceOf(Date);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('uses the tokens another pod already refreshed when Keycloak rejects the refresh token as used', async () => {
    const { agent, sid, cookie } = await expiringSession();
    const held = gateRefresh(t.oidc);
    const pending = agent.get(FORWARDED).then((res) => res);
    await held.started;
    // Meanwhile the other pod refreshes the same session: it redeems the refresh token and saves the rotated tokens.
    expect((await otherPod.http().set('cookie', cookie).get(FORWARDED)).status).toBe(200);
    const rotated = (await t.store.readSession(sid))?.auth?.tokens;
    held.release();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(bearers()).toEqual([`Bearer ${rotated?.accessToken}`, `Bearer ${rotated?.accessToken}`]);
    expect((await t.store.readSession(sid))?.auth?.tokens).toEqual(rotated);
  });

  it.each([
    ['unreachable', new AuthError('refresh_failed', { cause: new TypeError('fetch failed') })],
    // What openid-client reports for a 5xx without an OAuth error body.
    ['answering 5xx', new AuthError('refresh_failed', { detail: 'OAUTH_RESPONSE_IS_NOT_CONFORM' })],
    ['failing discovery', new AuthError('discovery_failed', { cause: new TypeError('fetch failed') })],
  ])('answers 503 and keeps the session row unchanged with Keycloak %s', async (_case, error) => {
    const { agent, sid } = await expiringSession();
    const before = await rowOf(sid);
    vi.spyOn(t.oidc, 'refresh').mockRejectedValueOnce(error);
    const res = await agent.get(FORWARDED);
    expect(res.status).toBe(503);
    expect(coreApi.received).toEqual([]);
    expect((await rowOf(sid))?.sess).toBe(before?.sess);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    // Keycloak is back: the next call refreshes and goes through.
    expect((await agent.get(FORWARDED)).status).toBe(200);
  });

  it('refreshes once for two concurrent requests on one session', async () => {
    const { agent } = await expiringSession();
    const held = gateRefresh(t.oidc);
    const both = Promise.all([agent.get(FORWARDED), agent.get(`${FORWARDED}/2`)]);
    await held.started;
    // Give the second request time to reach the refresh while the first one is still waiting on the IdP.
    await new Promise((resolve) => setTimeout(resolve, 100));
    held.release();
    expect((await both).map(({ status }) => status)).toEqual([200, 200]);
    expect(held.spy).toHaveBeenCalledTimes(1);
    expect(new Set(bearers()).size).toBe(1);
  });

  it('keeps a session ended by a logout that lands while its tokens are being refreshed', async () => {
    const { agent, sid, res: signedIn } = await expiringSession();
    expect(isFreshCookie(signedIn)).toBe(true);
    const held = gateRefresh(t.oidc);
    const pending = agent.get(FORWARDED).then((res) => res);
    await held.started;
    expect((await agent.post('/api/auth/logout')).status).toBe(200);
    held.release();
    const res = await pending;
    expect(res.status).toBe(401);
    expect(isFreshCookie(res)).toBe(false);
    expect(coreApi.received).toEqual([]);
    const row = await rowOf(sid);
    expect(row?.destroyedAt).toBeInstanceOf(Date);
    expect(row?.sess).toBe('');
  });
});
