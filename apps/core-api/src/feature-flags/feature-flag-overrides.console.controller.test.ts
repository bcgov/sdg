import {
  featureFlagEvents,
  featureFlagOverrides,
  featureFlags,
  identities,
  principals,
  type FeatureFlagAudience,
} from '@repo/database';
import { asc } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTestApp, type TestApp } from '../testing/app.js';

const FLAGS = '/api/v1/console/feature-flags';
const HISTORY = '/api/v1/console/feature-flag-history';

type Request = ReturnType<ReturnType<TestApp['http']>['get']>;
type Marker = 'portal' | 'console' | 'none';

const path = (principalId: string, key = 'hello_world') => `${FLAGS}/${key}/overrides/${principalId}`;
const changeSchema = z.object({ from: z.boolean().nullable(), to: z.boolean() });

describe('Console override routes /api/v1/console/feature-flags/:key/overrides/:principalId (R18–R20)', () => {
  let t: TestApp;
  let token: string;
  let adminId: string;

  const auth = (request: Request, bearer = token) => request.set('Authorization', `Bearer ${bearer}`);
  const put = (principalId: string, enabled: boolean, key?: string, bearer?: string) =>
    auth(t.http().put(path(principalId, key)), bearer).send({ enabled });
  const remove = (principalId: string, key?: string) => auth(t.http().delete(path(principalId, key)));
  const history = async () => (await auth(t.http().get(`${HISTORY}?key=hello_world`))).body.events;
  const flag = (audience: FeatureFlagAudience) =>
    t.database.db.insert(featureFlags).values({ key: 'hello_world', audience, enabled: false, rolloutPct: 0 });

  /** A person whose identity carries the given sign-in marker (KTD5). */
  async function person(name: string, marker: Marker): Promise<string> {
    const [row] = await t.database.db
      .insert(principals)
      .values({ displayName: name, email: `${name.toLowerCase()}@example.com` })
      .returning({ id: principals.id });
    const id = row?.id ?? '';
    await t.database.db.insert(identities).values({
      principalId: id,
      issuer: t.idp.issuer,
      subject: `subject-${name}`,
      portalSignedInAt: marker === 'portal' ? new Date() : null,
      consoleSignedInAt: marker === 'console' ? new Date() : null,
    });
    return id;
  }

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

  it('Should set an override and record override_set with its target, then a flip as {from, to} (R18, R19)', async () => {
    await flag('portal');
    const x = await person('Xena', 'portal');
    const res = await put(x, true);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      principalId: x,
      name: 'Xena',
      email: 'xena@example.com',
      kind: 'resident',
      enabled: true,
    });
    expect((await put(x, false)).body).toMatchObject({ enabled: false });
    expect(await history()).toEqual([
      expect.objectContaining({ action: 'override_set', changes: { enabled: { from: true, to: false } } }),
      {
        id: expect.any(Number),
        flagKey: 'hello_world',
        action: 'override_set',
        actor: { principalId: adminId, name: 'Ada Lovelace' },
        subject: { principalId: x, name: 'Xena' },
        changes: { enabled: { from: null, to: true } },
        createdAt: expect.any(String),
      },
    ]);
  });

  it('Should record nothing when an override is set to the value it already has', async () => {
    await flag('portal');
    const x = await person('Xena', 'portal');
    await put(x, true);
    expect((await put(x, true)).status).toBe(200);
    expect(await history()).toHaveLength(1);
  });

  it('Should refuse a resident on a console flag with 404 and accept a console user (AE10, R18)', async () => {
    await flag('console');
    const [resident, staff] = await Promise.all([person('Rita', 'portal'), person('Sam', 'console')]);
    expect((await put(resident, true)).status).toBe(404);
    const res = await put(staff, true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ principalId: staff, kind: 'console-user' });
    expect(await t.database.db.$count(featureFlagOverrides)).toBe(1);
  });

  it('Should refuse a console user on a portal flag and a person with no marker on any flag', async () => {
    await flag('portal');
    const [staff, unmarked] = await Promise.all([person('Sam', 'console'), person('Nell', 'none')]);
    expect((await put(staff, true)).status).toBe(404);
    expect((await put(unmarked, true)).status).toBe(404);
    expect((await put('00000000-0000-4000-8000-000000000000', true)).status).toBe(404);
    expect(await history()).toEqual([]);
  });

  it('Should accept a resident and a console user on a both flag, each with their kind', async () => {
    await flag('both');
    const [resident, staff] = await Promise.all([person('Rita', 'portal'), person('Sam', 'console')]);
    expect((await put(resident, true)).body).toMatchObject({ kind: 'resident' });
    expect((await put(staff, false)).body).toMatchObject({ kind: 'console-user' });
    const detail = await auth(t.http().get(`${FLAGS}/hello_world`));
    expect(detail.body.overrides.map((o: { name: string; kind: string }) => [o.name, o.kind])).toEqual([
      ['Rita', 'resident'],
      ['Sam', 'console-user'],
    ]);
    expect(detail.body.overrideCounts).toEqual({ on: 1, off: 1 });
  });

  it('Should keep one row and consistent from values under two concurrent PUTs for a new override', async () => {
    await flag('portal');
    const x = await person('Xena', 'portal');
    const statuses = await Promise.all([put(x, true), put(x, false)].map(async (request) => (await request).status));
    expect(statuses).toEqual([200, 200]);
    const rows = await t.database.db.select().from(featureFlagOverrides);
    expect(rows).toHaveLength(1);
    const events = await t.database.db.select().from(featureFlagEvents).orderBy(asc(featureFlagEvents.id));
    const changes = events.map((event) => changeSchema.parse(event.changes.enabled));
    expect(changes).toHaveLength(2);
    expect(changes[0]?.from).toBeNull();
    expect(changes[1]?.from).toBe(changes[0]?.to);
    expect(rows[0]?.enabled).toBe(changes[1]?.to);
  });

  it('Should remove an override with 204 and record override_removed, and 404 when there is none', async () => {
    await flag('portal');
    const x = await person('Xena', 'portal');
    await put(x, false);
    expect((await remove(x)).status).toBe(204);
    expect(await t.database.db.$count(featureFlagOverrides)).toBe(0);
    expect((await history())[0]).toMatchObject({
      action: 'override_removed',
      subject: { principalId: x, name: 'Xena' },
      changes: { enabled: { from: false, to: null } },
    });
    expect((await remove(x)).status).toBe(404);
    expect(await history()).toHaveLength(2);
  });

  it('Should answer 404, never 500, to an override PUT or DELETE on a missing flag', async () => {
    const x = await person('Xena', 'portal');
    expect((await put(x, true, 'ghost')).status).toBe(404);
    expect((await remove(x, 'ghost')).status).toBe(404);
  });

  it('Should answer 400 to a malformed principal id or body', async () => {
    await flag('portal');
    expect((await put('not-a-uuid', true)).status).toBe(400);
    const x = await person('Xena', 'portal');
    expect((await auth(t.http().put(path(x))).send({ enabled: 'yes' })).status).toBe(400);
  });

  it('Should answer 403 to a portal token and to a console token without admin (R20)', async () => {
    await flag('portal');
    const x = await person('Xena', 'portal');
    const outsiders = await Promise.all([t.idp.portalToken(), t.idp.consoleToken(['viewer'])]);
    const statuses = await Promise.all(
      outsiders.flatMap((outsider) => [put(x, true, undefined, outsider), auth(t.http().delete(path(x)), outsider)]),
    );
    expect(statuses.map((res) => res.status)).toEqual([403, 403, 403, 403]);
    expect(await t.database.db.$count(featureFlagOverrides)).toBe(0);
  });

  it('Should describe the override routes under the console tag in the OpenAPI document', async () => {
    const { body } = await t.http().get('/api/docs-json');
    const route = body.paths[`${FLAGS}/{key}/overrides/{principalId}`];
    expect(route.put.tags).toEqual(['console']);
    expect(route.delete.tags).toEqual(['console']);
  });
});
