import type { OidcTokens } from '@repo/auth';
import { principals, sessions } from '@repo/portal-database';
import type { SessionData } from 'express-session';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp, resetOidcStub, type TestApp } from '../testing/app.js';
import { json, signIn, startUpstream, tokens, type Upstream } from '../testing/notification-upstream.js';
import type { PostgresSessionStore } from './postgres-session.store.js';
import { SESSION_STORE } from './session.module.js';

/** The idle limit under test; a user request re-stamps after a tenth of it (one minute). */
const TTL_SECONDS = 600;
const MINUTE = 60_000;
const START = new Date('2026-11-05T09:00:00Z').getTime();

const at = (ms: number): void => {
  vi.setSystemTime(START + ms);
};

/**
 * A user request's activity stamp and a background relay request's token refresh on the same session (KTD8, KTD16):
 * neither request's session copy may overwrite what the other stored.
 */
describe('activity stamps alongside concurrent token refreshes', () => {
  let t: TestApp;
  let upstream: Upstream;

  beforeAll(async () => {
    upstream = await startUpstream();
    t = await createTestApp({
      env: { SESSION_TTL_SECONDS: String(TTL_SECONDS), NOTIFICATION_API_URL: upstream.url },
    });
  });

  afterAll(async () => {
    await t.close();
    await new Promise((resolve) => upstream.server.close(resolve));
  });

  beforeEach(async () => {
    resetOidcStub(t.oidc);
    upstream.received.length = 0;
    upstream.respond.with = json;
    await t.database.db.delete(principals);
    await t.database.db.delete(sessions);
    vi.useFakeTimers({ toFake: ['Date'] });
    at(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The one stored session, decrypted through the store. */
  async function storedSession(): Promise<SessionData | null | undefined> {
    const rows = await t.database.db.select({ sid: sessions.sid }).from(sessions);
    if (rows.length !== 1 || !rows[0]) throw new Error(`expected one stored session, found ${rows.length}`);
    const { sid } = rows[0];
    const store = t.app.get<PostgresSessionStore>(SESSION_STORE);
    return new Promise((resolve, reject) => {
      store.get(sid, (error, value) => (error ? reject(error) : resolve(value)));
    });
  }

  it('keeps the tokens a background refresh saved while a stamping user request was in flight', async () => {
    const agent = await signIn(t, tokens({ expiresAt: START + MINUTE }));
    // The user request loads the session and stamps its first activity, then waits on notification-api.
    const release = Promise.withResolvers<void>();
    upstream.respond.with = (req, res) => {
      upstream.respond.with = json;
      void release.promise.then(() => json(req, res));
    };
    const user = agent.get('/api/v1/notifications/contact-points').then((response) => response);
    await expect.poll(() => upstream.received.length).toBe(1);

    // 20 seconds before expiry, a background request refreshes and saves the rotated tokens.
    at(40_000);
    expect((await agent.get('/api/v1/notifications/subscriptions').set('sdg-background', '1')).status).toBe(200);
    expect(t.oidc.refresh).toHaveBeenCalledTimes(1);

    release.resolve();
    expect((await user).status).toBe(200);
    expect((await storedSession())?.auth?.tokens).toEqual(
      expect.objectContaining({ accessToken: 'refreshed-access-token' }),
    );
    expect((await storedSession())?.lastActivityAt).toBe(START);
  });

  it('keeps a user request stamp that lands while a background refresh is in flight', async () => {
    const agent = await signIn(t, tokens({ expiresAt: START + 6 * MINUTE + 10_000 }));
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    // A background request loads the session (stamped at minute 0) and waits on the identity provider.
    at(6 * MINUTE);
    const idp = Promise.withResolvers<OidcTokens>();
    t.oidc.refresh.mockReturnValue(idp.promise);
    const background = agent
      .get('/api/v1/notifications/subscriptions')
      .set('sdg-background', '1')
      .then((response) => response);
    await expect.poll(() => t.oidc.refresh.mock.calls.length).toBe(1);

    // Meanwhile the user acts, restarting the clock at minute 6; then the refresh saves its older copy.
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    idp.resolve(tokens({ accessToken: 'refreshed-access-token', expiresAt: START + 60 * MINUTE }));
    expect((await background).status).toBe(200);
    // expect.poll advances the faked clock by its polling interval, so the stamp may be a little past minute 6.
    expect((await storedSession())?.lastActivityAt).toBeGreaterThanOrEqual(START + 6 * MINUTE);

    at(11 * MINUTE);
    expect((await agent.get('/api/auth/me').set('sdg-background', '1')).status).toBe(200);
  });
});
