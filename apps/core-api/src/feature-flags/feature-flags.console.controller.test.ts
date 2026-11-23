import {
  featureFlagEvents,
  featureFlagOverrides,
  featureFlags,
  identities,
  principals,
  type FeatureFlag,
} from '@repo/database';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../database/database.module.js';
import { createTestApp, type TestApp } from '../testing/app.js';
import { FeatureFlagsService } from './feature-flags.service.js';
import type { FlagCache } from './flag-cache.service.js';

const FLAGS = '/api/v1/console/feature-flags';
const HISTORY = '/api/v1/console/feature-flag-history';

type Request = ReturnType<ReturnType<TestApp['http']>['get']>;

describe('Console flag routes /api/v1/console/feature-flags and /feature-flag-history (R15–R17, R19–R21)', () => {
  let t: TestApp;
  let token: string;
  let adminId: string;

  const auth = (request: Request, bearer = token) => request.set('Authorization', `Bearer ${bearer}`);
  const create = (body: object, bearer = token) => auth(t.http().post(FLAGS), bearer).send(body);
  const patch = (key: string, body: object) => auth(t.http().patch(`${FLAGS}/${key}`)).send(body);
  const history = async (query = '') => (await auth(t.http().get(`${HISTORY}${query}`))).body.items;

  /** A resident who signed in to the portal, as the override target. */
  async function resident(name: string): Promise<string> {
    const [row] = await t.database.db
      .insert(principals)
      .values({ displayName: name, email: `${name.toLowerCase()}@example.com` })
      .returning({ id: principals.id });
    const id = row?.id ?? '';
    await t.database.db
      .insert(identities)
      .values({ principalId: id, issuer: t.idp.issuer, subject: `bcsc-${name}`, portalSignedInAt: new Date() });
    return id;
  }

  const override = (flagKey: string, userId: string, enabled: boolean) =>
    t.database.db.insert(featureFlagOverrides).values({ flagKey, userId, enabled });

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    t.idp.reset();
    await Promise.all([
      t.database.db.delete(featureFlags),
      t.database.db.delete(featureFlagEvents),
      t.database.db.delete(principals),
    ]);
    token = await t.idp.consoleToken(['admin']);
    const login = await auth(t.http().post('/internal/principals/login'));
    if (login.status !== 200) throw new Error(`Console sign-in failed with HTTP ${login.status}`);
    adminId = login.body.principalId;
  });

  it('Should show a console create, edit and delete in the cached public flag list at once', async () => {
    const publicList = async () => (await t.http().get('/api/v1/shared/flags')).body;
    expect(await publicList()).toEqual({});
    expect((await create({ key: 'hello_world', enabled: true, rolloutPct: 100 })).status).toBe(201);
    expect(await publicList()).toEqual({ hello_world: true });
    expect((await patch('hello_world', { enabled: false })).status).toBe(200);
    expect(await publicList()).toEqual({});
    await patch('hello_world', { enabled: true });
    expect(await publicList()).toEqual({ hello_world: true });
    expect((await auth(t.http().delete(`${FLAGS}/hello_world`))).status).toBe(204);
    expect(await publicList()).toEqual({});
  });

  it('Should create a flag with 201 and record a created event with its initial state (R15, R19)', async () => {
    const res = await create({ key: 'hello_world', description: '  Says hello  ', rolloutPct: 0 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      key: 'hello_world',
      description: 'Says hello',
      enabled: false,
      rolloutPct: 0,
      audience: 'portal',
      overrideCounts: { on: 0, off: 0 },
    });
    expect(await history()).toEqual([
      {
        id: expect.any(Number),
        flagKey: 'hello_world',
        action: 'created',
        actor: { principalId: adminId, name: 'Ada Lovelace' },
        subject: null,
        changes: {
          description: { from: null, to: 'Says hello' },
          enabled: { from: null, to: false },
          rollout_pct: { from: null, to: 0 },
          audience: { from: null, to: 'portal' },
        },
        createdAt: expect.any(String),
      },
    ]);
  });

  it('Should store an empty description as null', async () => {
    expect((await create({ key: 'hello_world', description: '   ' })).body.description).toBeNull();
  });

  it('Should answer 409 to a duplicate key and record no second event', async () => {
    await create({ key: 'hello_world' });
    expect((await create({ key: 'hello_world', audience: 'console' })).status).toBe(409);
    expect(await history()).toHaveLength(1);
  });

  it.each([
    ['an upper-case key', { key: 'Hello' }],
    ['a key starting with a digit', { key: '9x' }],
    ['a key with a colon', { key: 'a:b' }],
    ['a 64-character key', { key: `a${'b'.repeat(63)}` }],
    ['a rollout of 101', { key: 'hello_world', rolloutPct: 101 }],
    ['a rollout of 1.5', { key: 'hello_world', rolloutPct: 1.5 }],
    ['an unknown audience', { key: 'hello_world', audience: 'everyone' }],
    ['a 501-character description', { key: 'hello_world', description: 'x'.repeat(501) }],
  ])('Should answer 400 to %s (KTD13)', async (_case, body) => {
    expect((await create(body)).status).toBe(400);
    expect(await t.database.db.$count(featureFlags)).toBe(0);
  });

  it('Should accept a 63-character key', async () => {
    expect((await create({ key: `a${'b'.repeat(62)}` })).status).toBe(201);
  });

  it('Should show a flag’s detail with each override’s current name, email and kind', async () => {
    await create({ key: 'hello_world' });
    const x = await resident('Xena');
    await override('hello_world', x, true);
    const res = await auth(t.http().get(`${FLAGS}/hello_world`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: 'hello_world', overrideCounts: { on: 1, off: 0 } });
    expect(res.body.overrides).toEqual([
      { principalId: x, name: 'Xena', email: 'xena@example.com', kind: 'resident', enabled: true },
    ]);
    expect((await auth(t.http().get(`${FLAGS}/ghost`))).status).toBe(404);
  });

  it('Should patch the rollout alone, leaving the other fields, and record only rollout_pct (R16)', async () => {
    await create({ key: 'hello_world', description: 'Says hello', audience: 'both', rolloutPct: 50 });
    const res = await patch('hello_world', { rolloutPct: 80 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ description: 'Says hello', audience: 'both', enabled: false, rolloutPct: 80 });
    const [latest] = await history();
    expect(latest).toMatchObject({ action: 'updated', changes: { rollout_pct: { from: 50, to: 80 } } });
    expect(Object.keys(latest.changes)).toEqual(['rollout_pct']);
  });

  it('Should record no event for a patch that changes nothing', async () => {
    await create({ key: 'hello_world', rolloutPct: 50 });
    expect((await patch('hello_world', { rolloutPct: 50, enabled: false })).status).toBe(200);
    expect((await patch('hello_world', {})).status).toBe(200);
    expect(await history()).toHaveLength(1);
  });

  it('Should answer 400 to a patch that tries to change the key (R2)', async () => {
    await create({ key: 'hello_world' });
    expect((await patch('hello_world', { key: 'renamed' })).status).toBe(400);
  });

  it('Should return the count of "on" overrides when a patch turns a flag off (R21)', async () => {
    await create({ key: 'hello_world', enabled: true });
    const [x, y, z] = await Promise.all([resident('Xena'), resident('Yuri'), resident('Zoe')]);
    await Promise.all([override('hello_world', x, true), override('hello_world', y, true)]);
    await override('hello_world', z, false);
    const res = await patch('hello_world', { enabled: false });
    expect(res.body).toMatchObject({ enabled: false, overrideCounts: { on: 2, off: 1 } });
  });

  it('Should answer 404, never 500, to a patch or delete of a missing key', async () => {
    expect((await patch('ghost', { enabled: true })).status).toBe(404);
    expect((await auth(t.http().delete(`${FLAGS}/ghost`))).status).toBe(404);
    expect(await history()).toEqual([]);
  });

  it('Should delete a flag with two overrides, and keep its whole history filtered by key (AE7, R17, R19)', async () => {
    await create({ key: 'hello_world' });
    await create({ key: 'other_flag' });
    await patch('hello_world', { enabled: true });
    const [x, y] = await Promise.all([resident('Xena'), resident('Yuri')]);
    await Promise.all([override('hello_world', x, true), override('hello_world', y, false)]);

    expect((await auth(t.http().delete(`${FLAGS}/hello_world`))).status).toBe(204);
    expect((await auth(t.http().get(`${FLAGS}/hello_world`))).status).toBe(404);
    expect(await t.database.db.$count(featureFlagOverrides)).toBe(0);
    const events = await history('?key=hello_world');
    expect(events.map((event: { action: string }) => event.action)).toEqual(['deleted', 'updated', 'created']);
    expect(events[0]).toMatchObject({ flagKey: 'hello_world', changes: { overridesRemoved: 2 }, subject: null });
  });

  it('Should page the history newest first with cursors, and join the target’s current name (KTD3)', async () => {
    await create({ key: 'a_flag' });
    await create({ key: 'b_flag' });
    const x = await resident('Xena');
    await t.database.db.insert(featureFlagEvents).values({
      flagKey: 'b_flag',
      action: 'override_set',
      actorPrincipalId: adminId,
      actorName: 'Ada Lovelace',
      subjectPrincipalId: x,
      changes: { enabled: { from: null, to: true } },
    });
    await t.database.db.update(principals).set({ displayName: 'Xena Renamed' }).where(eq(principals.id, x));

    const first = await auth(t.http().get(`${HISTORY}?limit=2`));
    expect(first.status).toBe(200);
    expect(first.body.items.map((event: { action: string }) => event.action)).toEqual(['override_set', 'created']);
    expect(first.body.items[0].subject).toEqual({ principalId: x, name: 'Xena Renamed' });
    expect(first.body).toMatchObject({ older: first.body.items[1].id, newer: null });
    const second = await auth(t.http().get(`${HISTORY}?limit=2&before=${first.body.older}`));
    expect(second.body).toEqual({
      items: [expect.objectContaining({ flagKey: 'a_flag' })],
      older: null,
      newer: second.body.items[0].id,
    });
    expect((await auth(t.http().get(`${HISTORY}?limit=0`))).status).toBe(400);
  });

  it('Should answer 403 to a portal token and to a console token without admin on every route (R20)', async () => {
    await create({ key: 'hello_world' });
    const outsiders = await Promise.all([t.idp.portalToken(), t.idp.consoleToken(['viewer'])]);
    for (const outsider of outsiders) {
      const requests = [
        t.http().get(FLAGS),
        t.http().post(FLAGS).send({ key: 'new_flag' }),
        t.http().get(`${FLAGS}/hello_world`),
        t.http().patch(`${FLAGS}/hello_world`).send({ enabled: true }),
        t.http().delete(`${FLAGS}/hello_world`),
        t.http().get(HISTORY),
      ];
      // oxlint-disable-next-line no-await-in-loop -- a handful of requests per token.
      const statuses = await Promise.all(requests.map(async (request) => (await auth(request, outsider)).status));
      expect(statuses).toEqual([403, 403, 403, 403, 403, 403]);
    }
    expect(await t.database.db.$count(featureFlags)).toBe(1);
  });

  it('Should answer 403 to a change from an administrator who never signed in', async () => {
    const stranger = await t.idp.consoleToken(['admin'], { sub: 'idir-never-signed-in' });
    expect((await create({ key: 'hello_world' }, stranger)).status).toBe(403);
    expect(await t.database.db.$count(featureFlags)).toBe(0);
  });

  it('Should answer a flag detail with an empty overrides list when it has no overrides', async () => {
    await create({ key: 'hello_world' });
    const res = await auth(t.http().get(`${FLAGS}/hello_world`));
    expect(res.status).toBe(200);
    expect(res.body.overrides).toEqual([]);
  });

  it('Should describe the routes under the console tag in the OpenAPI document', async () => {
    const { body } = await t.http().get('/api/docs-json');
    expect(body.paths[FLAGS].get.tags).toEqual(['console']);
    expect(body.paths[FLAGS].post.tags).toEqual(['console']);
    expect(Object.keys(body.paths[`${FLAGS}/{key}`]).toSorted()).toEqual(['delete', 'get', 'patch']);
    expect(body.paths[HISTORY].get.tags).toEqual(['console']);
  });
});

function stubFlag(key: string): FeatureFlag {
  return {
    key,
    description: null,
    enabled: false,
    rolloutPct: 100,
    audience: 'portal',
  };
}

function stubCache(): FlagCache {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal cache stub for defensive branch coverage
  return { invalidate: () => undefined } as unknown as FlagCache;
}

describe('FeatureFlagsService defensive branches', () => {
  it('Should omit overrides whose principal target is missing and sort remaining overrides by name', async () => {
    const flag = stubFlag('stub_flag');
    let selectCall = 0;
    const db = {
      select: () => {
        selectCall += 1;
        const call = selectCall;
        return {
          from: () => ({
            leftJoin: () => ({
              where: () => ({
                groupBy: () =>
                  Promise.resolve([
                    { principalId: 'p-2', name: 'Zoe', email: null, portal: true, console: false },
                    { principalId: 'p-1', name: 'Ada', email: 'ada@example.com', portal: true, console: false },
                  ]),
              }),
            }),
            where: () => {
              if (call === 1) return Promise.resolve([flag]);
              return Promise.resolve([
                { flagKey: 'stub_flag', userId: 'missing-id', enabled: true },
                { flagKey: 'stub_flag', userId: 'p-2', enabled: false },
                { flagKey: 'stub_flag', userId: 'p-1', enabled: true },
              ]);
            },
          }),
        };
      },
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal db stub for detail() branch coverage
    const service = new FeatureFlagsService(db as unknown as Database, stubCache());

    const detail = await service.detail('stub_flag');
    expect(detail.overrides.map((o) => o.name)).toEqual(['Ada', 'Zoe']);
  });

  it('Should fall back to current flag when update returning is empty and NO_OVERRIDES when countOverrides is empty', async () => {
    const current = stubFlag('stub_flag');
    let txSelectCall = 0;
    const tx = {
      select: () => {
        txSelectCall += 1;
        const call = txSelectCall;
        return {
          from: () => ({
            where: () => (call === 1 ? { for: () => Promise.resolve([current]) } : Promise.resolve([])),
          }),
        };
      },
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      }),
      insert: () => ({
        values: () => Promise.resolve(),
      }),
    };
    const db = {
      transaction: async <T>(fn: (arg: typeof tx) => Promise<T>) => fn(tx),
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal db stub for update() and countOverrides() branch coverage
    const service = new FeatureFlagsService(db as unknown as Database, stubCache());

    const summary = await service.update(
      'stub_flag',
      { enabled: true },
      { principalId: '00000000-0000-0000-0000-000000000001', name: 'Admin' },
    );
    expect(summary).toEqual({
      key: 'stub_flag',
      description: null,
      enabled: false,
      rolloutPct: 100,
      audience: 'portal',
      overrideCounts: { on: 0, off: 0 },
    });
  });
});
