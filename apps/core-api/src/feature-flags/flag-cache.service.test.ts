import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../database/database.module.js';
import { FLAG_CACHE_TTL_MS, FlagCache, type CachedFlag } from './flag-cache.service.js';

function createStubDb(selectImpl: () => Promise<CachedFlag[]>): Database {
  const db = {
    select: () => ({
      from: selectImpl,
    }),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal query builder stub for FlagCache unit tests
  return db as unknown as Database;
}

describe('FlagCache', () => {
  it('Should cache flags until TTL expires and share concurrent loads', async () => {
    let calls = 0;
    let resolveLoad!: (flags: CachedFlag[]) => void;
    const db = createStubDb(
      () =>
        new Promise<CachedFlag[]>((resolve) => {
          calls += 1;
          resolveLoad = resolve;
        }),
    );
    const cache = new FlagCache(db);

    const first = cache.flags();
    const second = cache.flags();
    expect(calls).toBe(1);

    const expected: CachedFlag[] = [{ key: 'hello_world', enabled: true, rolloutPct: 100, audience: 'portal' }];
    resolveLoad(expected);
    await expect(Promise.all([first, second])).resolves.toEqual([expected, expected]);

    // Fresh cache hit does not query again
    await expect(cache.flags()).resolves.toEqual(expected);
    expect(calls).toBe(1);

    // Expired TTL triggers a new load
    const now = Date.now();
    const later = vi.spyOn(Date, 'now').mockReturnValue(now + FLAG_CACHE_TTL_MS);
    try {
      const refreshed = cache.flags();
      expect(calls).toBe(2);
      resolveLoad([]);
      await expect(refreshed).resolves.toEqual([]);
    } finally {
      later.mockRestore();
    }
  });

  it('Should not store stale flags or clear newer loading state when invalidated in-flight', async () => {
    let resolveFirst!: (flags: CachedFlag[]) => void;
    let resolveSecond!: (flags: CachedFlag[]) => void;
    let call = 0;
    const db = createStubDb(
      () =>
        new Promise<CachedFlag[]>((resolve) => {
          call += 1;
          if (call === 1) resolveFirst = resolve;
          else resolveSecond = resolve;
        }),
    );
    const cache = new FlagCache(db);

    const first = cache.flags();
    cache.invalidate();

    const second = cache.flags();
    const staleFlags: CachedFlag[] = [{ key: 'stale', enabled: true, rolloutPct: 100, audience: 'portal' }];
    const freshFlags: CachedFlag[] = [{ key: 'fresh', enabled: true, rolloutPct: 100, audience: 'portal' }];

    resolveFirst(staleFlags);
    await expect(first).resolves.toEqual(staleFlags);

    // A concurrent caller during the second load still shares the second load's promise (this.loading was not cleared)
    const third = cache.flags();
    expect(call).toBe(2);

    resolveSecond(freshFlags);
    await expect(Promise.all([second, third])).resolves.toEqual([freshFlags, freshFlags]);
    await expect(cache.flags()).resolves.toEqual(freshFlags);
    expect(call).toBe(2);
  });
});
