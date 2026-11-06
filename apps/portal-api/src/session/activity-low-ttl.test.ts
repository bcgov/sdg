import { principals, sessions } from '@repo/portal-database';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp, resetOidcStub, type TestApp } from '../testing/app.js';
import { signIn } from '../testing/notification-upstream.js';

/** The lowest idle limit SESSION_TTL_SECONDS allows. */
const TTL_SECONDS = 300;
const MINUTE = 60_000;
const START = new Date('2026-11-05T09:00:00Z').getTime();

describe('session idle limit at the lowest SESSION_TTL_SECONDS (KTD8)', () => {
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
  });

  it('keeps a user who acts every minute signed in, and still ends the session after the limit with no activity', async () => {
    const agent = await signIn(t);
    for (let minute = 0; minute <= 12; minute += 1) {
      vi.setSystemTime(START + minute * MINUTE);
      // oxlint-disable-next-line no-await-in-loop -- each request must see the clock the previous one left.
      expect((await agent.get('/api/auth/me')).status, `user request at minute ${minute}`).toBe(200);
    }

    vi.setSystemTime(START + 18 * MINUTE);
    expect((await agent.get('/api/auth/me').set('sdg-background', '1')).status).toBe(401);
  });
});
