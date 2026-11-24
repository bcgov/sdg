import { randomUUID } from 'node:crypto';

import { featureFlagEvents, featureFlags, principals, type FeatureFlagEvent } from '@repo/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../database/database.module.js';
import { createTestApp, type TestApp } from '../testing/app.js';
import { readHistory } from './flag-history.query.js';

const HISTORY = '/api/v1/console/feature-flag-history';

interface Page {
  items: {
    id: number;
    flagKey: string;
    subject?: { principalId: string; name: string | null } | null;
  }[];
  older: number | null;
  newer: number | null;
}

const ids = (from: Page) => from.items.map((event) => event.id);

function makeMockEvent(id: number | undefined): { event: FeatureFlagEvent; subjectName: string | null } {
  return {
    event: {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberately simulate missing id for branch coverage
      id: id as unknown as number,
      flagKey: 'stub_flag',
      action: 'created',
      actorPrincipalId: randomUUID(),
      actorName: 'Ada Lovelace',
      subjectPrincipalId: null,
      changes: {},
      createdAt: new Date(),
    },
    subjectName: null,
  };
}

function mockDb(rows: { event: FeatureFlagEvent; subjectName: string | null }[]) {
  let callCount = 0;
  const queryBuilder = {
    from: () => queryBuilder,
    leftJoin: () => queryBuilder,
    where: () => queryBuilder,
    orderBy: () => queryBuilder,
    limit: () => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(rows);
      }
      return Promise.resolve([{ id: 1 }]);
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal query builder stub for edge case coverage
  return { select: () => queryBuilder } as unknown as Database;
}

describe('Console flag history GET /api/v1/console/feature-flag-history, two-way cursors (R13, R19, R20, KTD3)', () => {
  let t: TestApp;
  let token: string;

  const get = (query: string) => t.http().get(`${HISTORY}${query}`).set('Authorization', `Bearer ${token}`);
  const page = async (query: string): Promise<Page> => {
    const res = await get(query);
    if (res.status !== 200) throw new Error(`History answered HTTP ${res.status}`);
    return res.body;
  };

  /** Follows `start`'s `side` cursor three times, as `before` for older and `after` for newer: four pages. */
  async function follow(start: Page, side: 'older' | 'newer'): Promise<Page[]> {
    const pages = [start];
    let cursor = start[side];
    for (let i = 0; i < 3; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each page's cursor comes from the one before.
      const next = await page(`?key=hello_world&limit=20&${side === 'older' ? 'before' : 'after'}=${cursor}`);
      pages.push(next);
      cursor = next[side];
    }
    return pages;
  }

  /** Records `count` updates of `flagKey`, oldest first, and answers their ids newest first. */
  async function events(flagKey: string, count: number): Promise<number[]> {
    const actorPrincipalId = randomUUID();
    const rows = await t.database.db
      .insert(featureFlagEvents)
      .values(
        Array.from({ length: count }, (_, i) => ({
          flagKey,
          action: 'updated' as const,
          actorPrincipalId,
          actorName: 'Ada Lovelace',
          changes: { rollout_pct: { from: i, to: i + 1 } },
        })),
      )
      .returning({ id: featureFlagEvents.id });
    return rows.map((row) => row.id).toSorted((a, b) => b - a);
  }

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    t.idp.reset();
    await Promise.all([t.database.db.delete(featureFlags), t.database.db.delete(featureFlagEvents)]);
    token = await t.idp.consoleToken(['admin']);
  });

  it('Should page 75 events older to the oldest 15 and newer back again, never sharing an event (AE5)', async () => {
    await t.database.db.insert(featureFlags).values([{ key: 'hello_world' }, { key: 'other_flag' }]);
    await events('other_flag', 3);
    const all = await events('hello_world', 75);
    const expected = [all.slice(0, 20), all.slice(20, 40), all.slice(40, 60), all.slice(60)];

    const newest = await page('?key=hello_world&limit=20');
    expect(newest).toMatchObject({ newer: null, older: all[19] });
    const olderPages = await follow(newest, 'older');
    expect(olderPages.map(ids)).toEqual(expected);
    const oldest = olderPages[3];
    expect(oldest).toMatchObject({ older: null, newer: all[60] });

    const newerPages = oldest === undefined ? [] : await follow(oldest, 'newer');
    expect(newerPages.map(ids)).toEqual(expected.toReversed());
    expect(newerPages[3]).toEqual(newest);
    expect(new Set(olderPages.flatMap(ids)).size).toBe(75);
  });

  it('Should answer the cursors of a middle page reached with after (KTD3)', async () => {
    const all = await events('hello_world', 75);
    const middle = await page(`?limit=20&after=${all[60]}`);
    expect(ids(middle)).toEqual(all.slice(40, 60));
    expect(middle).toMatchObject({ older: all[59], newer: all[40] });
  });

  it('Should answer the newest page to after the newest id, as with no cursor (KTD3)', async () => {
    const all = await events('hello_world', 30);
    const newest = await page('?limit=20');
    expect(await page(`?limit=20&after=${all[0]}`)).toEqual(newest);
    expect(await page(`?limit=20&after=${all[5]}`)).toEqual(newest);
    expect(newest).toMatchObject({ newer: null, older: all[19] });
  });

  it('Should answer null cursors with a page that has no items', async () => {
    const all = await events('hello_world', 5);
    expect(await page(`?before=${all.at(-1)}`)).toEqual({ items: [], older: null, newer: null });
    expect(await page('?key=never_existed')).toEqual({ items: [], older: null, newer: null });
  });

  it.each([
    ['before and after together', '?before=10&after=5'],
    ['a cursor of 0', '?before=0'],
    ['a limit above 100', '?limit=101'],
  ])('Should answer 400 to %s', async (_, query) => {
    expect((await get(query)).status).toBe(400);
  });

  it('Should page a deleted flag’s history (R19)', async () => {
    const all = await events('gone_flag', 25);
    const newest = await page('?key=gone_flag&limit=20');
    expect(ids(newest)).toEqual(all.slice(0, 20));
    const oldest = await page(`?key=gone_flag&limit=20&before=${newest.older}`);
    expect(oldest).toEqual({ items: expect.any(Array), older: null, newer: all[20] });
    expect(ids(oldest)).toEqual(all.slice(20));
  });

  it('Should answer null older cursor when after query has more newer events but no older events', async () => {
    const all = await events('start_flag', 25);
    const oldestId = all[24]!;
    const res = await page(`?key=start_flag&limit=20&after=${oldestId - 1}`);
    expect(res.items.length).toBe(20);
    expect(res.older).toBeNull();
    expect(res.newer).toBe(all[5]);
  });

  it('Should include subject details when an event has a subjectPrincipalId', async () => {
    const subjectId = randomUUID();
    await t.database.db.insert(principals).values({ id: subjectId, displayName: 'Subject User' });
    await t.database.db.insert(featureFlagEvents).values({
      flagKey: 'subject_flag',
      action: 'override_set',
      actorPrincipalId: randomUUID(),
      actorName: 'Ada Lovelace',
      subjectPrincipalId: subjectId,
      changes: { enabled: { from: null, to: true } },
    });
    const res = await page('?key=subject_flag&limit=10');
    expect(res.items[0]?.subject).toEqual({ principalId: subjectId, name: 'Subject User' });
  });

  describe('readHistory cursor fallback branches', () => {
    it('Should fallback to null for newer cursor when boundary item has no id (line 58)', async () => {
      const db = mockDb([makeMockEvent(10), makeMockEvent(undefined), makeMockEvent(30)]);
      const result = await readHistory(db, { limit: 2, after: 5 });
      expect(result.newer).toBeNull();
      expect(result.older).toBe(10);
    });

    it('Should fallback to null for older cursor when boundary item has no id (line 65)', async () => {
      const db = mockDb([makeMockEvent(10), makeMockEvent(undefined), makeMockEvent(30)]);
      const result = await readHistory(db, { limit: 2 });
      expect(result.older).toBeNull();
      expect(result.newer).toBeNull();
    });
  });
});
