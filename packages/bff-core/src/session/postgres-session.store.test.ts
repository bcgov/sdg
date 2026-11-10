import { eq } from 'drizzle-orm';
import type { SessionData } from 'express-session';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestSessionDatabase, type TestSessionDatabase } from '../test-support/database.js';
import { PostgresSessionStore, type SessionStoreLogger } from './postgres-session.store.js';
import { deriveSessionKey } from './session-cipher.js';
import { sessions } from './sessions.schema.js';

const key = deriveSessionKey('test-session-secret-at-least-32-characters', 'portal-session-store');
const HOUR_MS = 3_600_000;

function sessionExpiringIn(ms: number, accessToken = 'access-token-value'): SessionData {
  return {
    cookie: { originalMaxAge: ms, expires: new Date(Date.now() + ms), httpOnly: true, path: '/' },
    auth: {
      principalId: 'principal-1',
      user: { name: 'Ada Lovelace', email: 'ada@example.com' },
      tokens: { idToken: 'id-token-value', accessToken, refreshToken: null, expiresAt: null },
    },
  };
}

/** Promisifies one express-session store call. */
function call<T>(fn: (cb: (error: unknown, value?: T) => void) => void): Promise<T | undefined> {
  return new Promise((resolve, reject) => fn((error, value) => (error ? reject(error) : resolve(value))));
}

function testLogger(): { [K in keyof SessionStoreLogger]: ReturnType<typeof vi.fn<SessionStoreLogger[K]>> } {
  return { warn: vi.fn<SessionStoreLogger['warn']>(), error: vi.fn<SessionStoreLogger['error']>() };
}

describe('PostgresSessionStore', () => {
  let database: TestSessionDatabase;
  let store: PostgresSessionStore;
  let logger: ReturnType<typeof testLogger>;

  const get = (sid: string) => call<SessionData | null>((cb) => store.get(sid, cb));
  const set = (sid: string, data: SessionData) => call<void>((cb) => store.set(sid, data, cb));
  const destroy = (sid: string) => call<void>((cb) => store.destroy(sid, cb));
  const rowOf = async (sid: string) => (await database.db.select().from(sessions).where(eq(sessions.sid, sid)))[0];

  beforeAll(async () => {
    database = await createTestSessionDatabase();
  }, 60_000);

  afterAll(() => database.close());

  beforeEach(async () => {
    logger = testLogger();
    store = new PostgresSessionStore(database.db, { key, ttlSeconds: 3600, logger });
    await database.db.delete(sessions);
  });

  it('round-trips a session and stores it encrypted', async () => {
    const data = sessionExpiringIn(HOUR_MS);
    await set('sid-1', data);
    expect(await get('sid-1')).toEqual(JSON.parse(JSON.stringify(data)));
    const row = await rowOf('sid-1');
    expect(row?.sess).not.toContain('access-token-value');
    expect(row?.sess).not.toContain('ada@example.com');
    expect(row?.expiresAt.getTime()).toBe(data.cookie.expires?.getTime());
    expect(row?.destroyedAt).toBeNull();
  });

  it('overwrites a live session on set', async () => {
    await set('sid-1', sessionExpiringIn(HOUR_MS));
    await set('sid-1', { ...sessionExpiringIn(2 * HOUR_MS), auth: undefined });
    expect((await get('sid-1'))?.auth).toBeUndefined();
    expect(await database.db.$count(sessions)).toBe(1);
  });

  it('returns null for a missing or expired session', async () => {
    expect(await get('missing')).toBeNull();
    await set('sid-old', sessionExpiringIn(-1000));
    expect(await get('sid-old')).toBeNull();
  });

  it('returns null and warns for a payload it cannot decrypt', async () => {
    await set('sid-1', sessionExpiringIn(HOUR_MS));
    const other = new PostgresSessionStore(database.db, {
      key: deriveSessionKey('test-session-secret-at-least-32-characters', 'admin-session-store'),
      ttlSeconds: 3600,
      logger,
    });
    expect(await call<SessionData | null>((cb) => other.get('sid-1', cb))).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith({
      msg: 'Discarding unreadable session',
      error: expect.objectContaining({ message: 'Unsupported state or unable to authenticate data' }),
    });
  });

  describe('tombstones (KTD7)', () => {
    it('destroy leaves a tombstone without the payload, which reads as no session', async () => {
      await set('sid-1', sessionExpiringIn(HOUR_MS));
      await destroy('sid-1');
      expect(await get('sid-1')).toBeNull();
      const row = await rowOf('sid-1');
      expect(row?.destroyedAt).toBeInstanceOf(Date);
      expect(row?.sess).toBe('');
    });

    it('a save racing a destroy cannot bring the session back', async () => {
      const loaded = sessionExpiringIn(HOUR_MS, 'old-access-token');
      await set('sid-1', loaded);
      // Request A loaded the session; request B (logout, perhaps on another pod) destroys it; A then saves.
      await destroy('sid-1');
      const refreshed = sessionExpiringIn(2 * HOUR_MS, 'refreshed-access-token');
      await set('sid-1', refreshed);
      expect(await get('sid-1')).toBeNull();
      expect(store.wasDestroyed(refreshed)).toBe(true);
      const row = await rowOf('sid-1');
      expect(row?.sess).toBe('');
      expect(row?.destroyedAt).toBeInstanceOf(Date);
    });

    it('a brand-new session id still inserts on its first save', async () => {
      const fresh = sessionExpiringIn(HOUR_MS);
      await set('brand-new', fresh);
      expect((await get('brand-new'))?.auth?.principalId).toBe('principal-1');
      expect(store.wasDestroyed(fresh)).toBe(false);
    });

    it('destroying twice keeps the first destruction time', async () => {
      await set('sid-1', sessionExpiringIn(HOUR_MS));
      await destroy('sid-1');
      const first = (await rowOf('sid-1'))?.destroyedAt;
      await destroy('sid-1');
      expect((await rowOf('sid-1'))?.destroyedAt).toEqual(first);
    });

    it('touch does not extend a tombstone', async () => {
      await set('sid-1', sessionExpiringIn(HOUR_MS));
      await destroy('sid-1');
      const before = (await rowOf('sid-1'))?.expiresAt;
      await call<void>((cb) => store.touch('sid-1', sessionExpiringIn(5 * HOUR_MS), cb));
      expect((await rowOf('sid-1'))?.expiresAt).toEqual(before);
    });
  });

  it('touch only writes when the expiry moves past the threshold', async () => {
    await set('sid-1', sessionExpiringIn(HOUR_MS));
    const original = (await rowOf('sid-1'))?.expiresAt;

    await call<void>((cb) => store.touch('sid-1', sessionExpiringIn(HOUR_MS + 60_000), cb));
    expect((await rowOf('sid-1'))?.expiresAt).toEqual(original);

    const later = sessionExpiringIn(HOUR_MS + 10 * 60_000);
    await call<void>((cb) => store.touch('sid-1', later, cb));
    expect((await rowOf('sid-1'))?.expiresAt.getTime()).toBe(later.cookie.expires?.getTime());
  });

  describe('database failures', () => {
    let broken: PostgresSessionStore;
    let brokenLogger: ReturnType<typeof testLogger>;

    beforeAll(async () => {
      const closed = await createTestSessionDatabase();
      await closed.close();
      brokenLogger = testLogger();
      broken = new PostgresSessionStore(closed.db, { key, ttlSeconds: 3600, logger: brokenLogger });
    }, 60_000);

    it('logs { msg, error } for a failed operation without a callback', async () => {
      broken.destroy('sid-1');
      await vi.waitFor(() =>
        expect(brokenLogger.error).toHaveBeenCalledWith({
          msg: 'Session destroy failed',
          error: expect.objectContaining({ type: expect.any(String), message: expect.any(String) }),
        }),
      );
    });

    it('passes database errors to the callback', async () => {
      await expect(call<SessionData | null>((cb) => broken.get('sid-1', cb))).rejects.toBeDefined();
    });
  });
});
