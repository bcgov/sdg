import { Logger } from '@nestjs/common';
import { sessions } from '@repo/portal-database';
import { eq } from 'drizzle-orm';
import type { SessionData } from 'express-session';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../testing/database.js';
import { PostgresSessionStore } from './postgres-session.store.js';
import { deriveSessionKey } from './session-cipher.js';

const key = deriveSessionKey('test-session-secret-at-least-32-characters');
const HOUR_MS = 3_600_000;

function sessionExpiringIn(ms: number): SessionData {
  return {
    cookie: { originalMaxAge: ms, expires: new Date(Date.now() + ms), httpOnly: true, path: '/' },
    auth: {
      principalId: 'principal-1',
      user: { name: 'Ada Lovelace', email: 'ada@example.com' },
      tokens: { idToken: 'id-token-value', accessToken: 'access-token-value', refreshToken: null, expiresAt: null },
    },
  };
}

/** Promisifies one express-session store call. */
function call<T>(fn: (cb: (error: unknown, value?: T) => void) => void): Promise<T | undefined> {
  return new Promise((resolve, reject) => fn((error, value) => (error ? reject(error) : resolve(value))));
}

describe('PostgresSessionStore', () => {
  let database: TestDatabase;
  let store: PostgresSessionStore;
  let brokenStore: PostgresSessionStore;

  const get = (sid: string) => call<SessionData | null>((cb) => store.get(sid, cb));
  const set = (sid: string, data: SessionData) => call<void>((cb) => store.set(sid, data, cb));
  const stampedAt = async (sid: string) => (await get(sid))?.lastActivityAt;
  const expiryOf = async (sid: string): Promise<Date | undefined> => {
    const [row] = await database.db.select().from(sessions).where(eq(sessions.sid, sid));
    return row?.expiresAt;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    store = new PostgresSessionStore(database.db, { key, ttlSeconds: 3600 });

    const brokenDb = await createTestDatabase();
    await brokenDb.close();
    brokenStore = new PostgresSessionStore(brokenDb.db, { key, ttlSeconds: 3600 });
  }, 60_000);

  afterAll(() => database.close());

  beforeEach(async () => {
    await database.db.delete(sessions);
  });

  it('round-trips a session and stores it encrypted', async () => {
    const data = sessionExpiringIn(HOUR_MS);
    await set('sid-1', data);
    expect(await get('sid-1')).toEqual(JSON.parse(JSON.stringify(data)));
    const [row] = await database.db.select().from(sessions).where(eq(sessions.sid, 'sid-1'));
    expect(row?.sess).not.toContain('access-token-value');
    expect(row?.sess).not.toContain('ada@example.com');
    expect(row?.expiresAt.getTime()).toBe(data.cookie.expires?.getTime());
  });

  it('overwrites an existing session on set', async () => {
    await set('sid-1', sessionExpiringIn(HOUR_MS));
    const updated = { ...sessionExpiringIn(2 * HOUR_MS), auth: undefined };
    await set('sid-1', updated);
    expect((await get('sid-1'))?.auth).toBeUndefined();
    expect(await database.db.$count(sessions)).toBe(1);
  });

  it('returns null for a missing or expired session', async () => {
    expect(await get('missing')).toBeNull();
    await set('sid-old', sessionExpiringIn(-1000));
    expect(await get('sid-old')).toBeNull();
  });

  it('returns null for a payload it cannot decrypt', async () => {
    await set('sid-1', sessionExpiringIn(HOUR_MS));
    const other = new PostgresSessionStore(database.db, {
      key: deriveSessionKey('another-secret-of-at-least-32-characters'),
      ttlSeconds: 3600,
    });
    const result = await call<SessionData | null>((cb) => other.get('sid-1', cb));
    expect(result).toBeNull();
  });

  it('destroys a session', async () => {
    await set('sid-1', sessionExpiringIn(HOUR_MS));
    await call<void>((cb) => store.destroy('sid-1', cb));
    expect(await database.db.$count(sessions)).toBe(0);
  });

  it('touch only writes when the expiry moves past the threshold', async () => {
    await set('sid-1', sessionExpiringIn(HOUR_MS));
    const original = await expiryOf('sid-1');

    await call<void>((cb) => store.touch('sid-1', sessionExpiringIn(HOUR_MS + 60_000), cb));
    expect(await expiryOf('sid-1')).toEqual(original);

    const later = sessionExpiringIn(HOUR_MS + 10 * 60_000);
    await call<void>((cb) => store.touch('sid-1', later, cb));
    expect((await expiryOf('sid-1'))?.getTime()).toBe(later.cookie.expires?.getTime());
  });

  describe('activity stamps (KTD8)', () => {
    const MINUTE = 60_000;
    const T0 = Date.now();

    it('stamps the stored session, leaves the rest of it as stored, and keeps it for the lifetime from then', async () => {
      const data = sessionExpiringIn(MINUTE);
      await set('sid-1', data);
      await store.stampActivity('sid-1', T0, 5 * MINUTE);
      expect(await get('sid-1')).toEqual({ ...JSON.parse(JSON.stringify(data)), lastActivityAt: T0 });
      expect((await expiryOf('sid-1'))?.getTime()).toBe(T0 + HOUR_MS);
    });

    it('stamps only when the stored stamp is older than the interval, and never moves it backwards', async () => {
      await set('sid-1', { ...sessionExpiringIn(HOUR_MS), lastActivityAt: T0 });
      await store.stampActivity('sid-1', T0 + 4 * MINUTE, 5 * MINUTE);
      expect(await stampedAt('sid-1')).toBe(T0);
      await store.stampActivity('sid-1', T0 - 10 * MINUTE, 5 * MINUTE);
      expect(await stampedAt('sid-1')).toBe(T0);
      await store.stampActivity('sid-1', T0 + 6 * MINUTE, 5 * MINUTE);
      expect(await stampedAt('sid-1')).toBe(T0 + 6 * MINUTE);
    });

    it('does not revive a destroyed session', async () => {
      await store.stampActivity('sid-gone', T0, 5 * MINUTE);
      expect(await database.db.$count(sessions)).toBe(0);
    });

    it('keeps a newer stored stamp when a session copy with an older or no stamp is saved', async () => {
      await set('sid-1', { ...sessionExpiringIn(HOUR_MS), lastActivityAt: T0 });
      await set('sid-1', { ...sessionExpiringIn(HOUR_MS), lastActivityAt: T0 - 10 * MINUTE });
      expect(await stampedAt('sid-1')).toBe(T0);
      await set('sid-1', sessionExpiringIn(HOUR_MS));
      expect(await stampedAt('sid-1')).toBe(T0);
      await set('sid-1', { ...sessionExpiringIn(HOUR_MS), lastActivityAt: T0 + MINUTE });
      expect(await stampedAt('sid-1')).toBe(T0 + MINUTE);
    });
  });

  it('logs { msg, err } for a failed operation without a callback', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    brokenStore.destroy('sid-1');
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith({
        msg: 'Session destroy failed',
        error: expect.objectContaining({ type: expect.any(String), message: expect.any(String) }),
      }),
    );
    error.mockRestore();
  });

  it('passes database errors to the callback', async () => {
    await expect(call<SessionData | null>((cb) => brokenStore.get('sid-1', cb))).rejects.toBeDefined();
  });
});
