import { Logger } from '@nestjs/common';
import { AuthError } from '@repo/auth';
import { principals, sessions } from '@repo/portal-database';
import { gt } from 'drizzle-orm';
import type supertest from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { RELAY_STREAM_PATH } from '../notifications/relay-stream.controller.js';
import { createTestApp, resetOidcStub, type TestApp } from '../testing/app.js';
import { signIn } from '../testing/notification-upstream.js';

/** The idle limit under test; the minimum SESSION_TTL_SECONDS allows is 300. */
const TTL_SECONDS = 600;
const MINUTE = 60_000;
const START = new Date('2026-11-05T09:00:00Z').getTime();

/** Moves the clock to `minutes` after the test's start. */
const at = (minutes: number): void => {
  vi.setSystemTime(START + minutes * MINUTE);
};
/** A user request: `/api/auth/me` without the background marker. */
const userRequest = (agent: supertest.Agent) => agent.get('/api/auth/me');
const backgroundRequest = (agent: supertest.Agent) => agent.get('/api/auth/me').set('sdg-background', '1');

describe('session idle limit and background requests (KTD8)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ env: { SESSION_TTL_SECONDS: String(TTL_SECONDS) } });
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    resetOidcStub(t.oidc);
    await t.database.db.delete(principals);
    await t.database.db.delete(sessions);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** The sessions the store would still load (expired rows wait for the pg_cron prune), payloads encrypted. */
  const liveSessions = () =>
    t.database.db
      .select({ sid: sessions.sid, sess: sessions.sess })
      .from(sessions)
      .where(gt(sessions.expiresAt, new Date()));
  const storedPayloads = async (): Promise<string[]> => (await liveSessions()).map(({ sess }) => sess);
  const storedIds = async (): Promise<string[]> => (await liveSessions()).map(({ sid }) => sid);

  /** Signs in and makes the first user request, which starts the session's clock at minute 0. Returns its id too. */
  async function signedIn(): Promise<{ agent: supertest.Agent; sid: string }> {
    const agent = await signIn(t);
    expect((await userRequest(agent)).status).toBe(200);
    const [sid, ...others] = await storedIds();
    if (sid === undefined || others.length > 0) throw new Error('expected exactly one stored session');
    return { agent, sid };
  }

  it('ends a session kept busy only by background requests once the idle limit passes (AE10)', async () => {
    const { agent, sid } = await signedIn();
    for (let minute = 1; minute <= 10; minute += 1) {
      at(minute);
      // oxlint-disable-next-line no-await-in-loop -- each request runs a minute after the last.
      expect((await backgroundRequest(agent)).status).toBe(200);
    }

    at(11);
    expect((await backgroundRequest(agent)).status).toBe(401);
    expect(t.oidc.endSession).toHaveBeenCalledTimes(1);
    expect(t.oidc.endSession).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'refresh-token' }));
    expect((await backgroundRequest(agent)).status).toBe(401);
    expect(await storedIds()).not.toContain(sid);
  });

  it('answers 401 to a user request after the idle limit with no requests, without reviving the session', async () => {
    const { agent } = await signedIn();

    at(11);
    expect((await userRequest(agent)).status).toBe(401);
    expect((await userRequest(agent)).status).toBe(401);
    expect(await storedIds()).toEqual([]);
  });

  it('destroys an idle-expired session and logs it when the back-channel end-session call fails', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    t.oidc.endSession.mockRejectedValue(new AuthError('end_session_failed', { detail: 'invalid_grant' }));
    const { agent, sid } = await signedIn();
    at(6);
    expect((await backgroundRequest(agent)).status).toBe(200);

    at(11);
    expect((await backgroundRequest(agent)).status).toBe(401);
    expect(t.oidc.endSession).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({
      msg: 'Ending the idle session at the identity provider failed; ending the portal session anyway',
      error: expect.objectContaining({ type: 'AuthError', code: 'end_session_failed', detail: 'invalid_grant' }),
    });
    expect((await userRequest(agent)).status).toBe(401);
    expect(await storedIds()).not.toContain(sid);
  });

  it('lets the request that finds its session idle-expired start a new sign-in', async () => {
    const { agent } = await signedIn();
    at(6);
    expect((await backgroundRequest(agent)).status).toBe(200);

    at(11);
    expect((await agent.get('/api/auth/login')).status).toBe(302);
    expect(t.oidc.endSession).toHaveBeenCalledTimes(1);
    expect(t.oidc.createAuthorizationRequest).toHaveBeenCalledTimes(2);
  });

  it('restarts the clock on a user request, so the session outlives the limit measured from sign-in', async () => {
    const { agent } = await signedIn();
    at(6);
    expect((await userRequest(agent)).status).toBe(200);

    at(12);
    expect((await backgroundRequest(agent)).status).toBe(200);
    at(17);
    expect((await backgroundRequest(agent)).status).toBe(401);
  });

  it('writes the session once for two user requests a minute apart', async () => {
    const agent = await signIn(t);
    const signedInPayloads = await storedPayloads();
    expect(signedInPayloads).toHaveLength(1);

    expect((await userRequest(agent)).status).toBe(200);
    const stamped = await storedPayloads();
    expect(stamped).not.toEqual(signedInPayloads);

    at(1);
    expect((await userRequest(agent)).status).toBe(200);
    expect(await storedPayloads()).toEqual(stamped);
  });

  it('creates no session for an anonymous request', async () => {
    expect((await t.http().get('/api/auth/me')).status).toBe(401);
    expect((await t.http().get('/api/auth/me').set('sdg-background', '1')).status).toBe(401);
    expect(await storedIds()).toEqual([]);
  });

  it('never restarts the clock for a stream connection, even without the background marker', async () => {
    const { agent } = await signedIn();
    at(6);
    // The relay is off in this app, so the route answers 404, but only after the activity middleware has run.
    expect((await agent.get(RELAY_STREAM_PATH)).status).toBe(404);

    at(11);
    expect((await backgroundRequest(agent)).status).toBe(401);
  });

  it('starts the clock of a signed-in session that has none at its next request, not at sign-in', async () => {
    const agent = await signIn(t);

    at(9);
    expect((await backgroundRequest(agent)).status).toBe(200);
    at(11);
    expect((await backgroundRequest(agent)).status).toBe(200);
  });
});
