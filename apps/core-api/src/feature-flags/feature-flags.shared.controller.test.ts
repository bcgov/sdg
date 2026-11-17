import { Logger } from '@nestjs/common';
import { featureFlagOverrides, featureFlags, identities, principals, type NewFeatureFlag } from '@repo/database';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';
import { FlagCache } from './flag-cache.service.js';

const FLAGS = '/api/v1/shared/flags';
const HELLO = '/api/v1/shared/hello-world';

const residents = (count: number) => Array.from({ length: count }, (_, index) => `resident-${index}`);

describe('Shared flag routes /api/v1/shared/flags and /hello-world (R3–R7, R10, R12)', () => {
  let t: TestApp;

  const get = (path: string, token?: string) => {
    const request = t.http().get(path);
    return token === undefined ? request : request.set('Authorization', `Bearer ${token}`);
  };
  const portal = (sub: string) => t.idp.portalToken({ sub });
  const consoleUser = (sub: string) => t.idp.consoleToken([], { sub });

  /** Flags written straight to the table, as the console would, so the cache is cleared as a console change clears it. */
  const clearFlagCache = () => t.app.get(FlagCache).invalidate();
  const flag = async (key: string, fields: Partial<NewFeatureFlag> = {}) => {
    await t.database.db.insert(featureFlags).values({ key, enabled: true, rolloutPct: 100, ...fields });
    clearFlagCache();
  };
  const helloWorld = (fields: Partial<NewFeatureFlag> = {}) => flag('hello_world', fields);
  const override = (userId: string, enabled: boolean) =>
    t.database.db.insert(featureFlagOverrides).values({ flagKey: 'hello_world', userId, enabled });
  /** Turns hello_world on or off as a console edit would, clearing the cache. */
  const setEnabled = async (enabled: boolean) => {
    await t.database.db.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, 'hello_world'));
    clearFlagCache();
  };

  /** Principals with an identity for each subject at the test IdP, as a sign-in would leave them. */
  async function seed(subjects: string[]): Promise<string[]> {
    const rows = await t.database.db
      .insert(principals)
      .values(subjects.map((subject) => ({ displayName: `Person ${subject}` })))
      .returning({ id: principals.id });
    await t.database.db
      .insert(identities)
      .values(rows.map(({ id }, index) => ({ principalId: id, issuer: t.idp.issuer, subject: subjects[index] ?? '' })));
    return rows.map(({ id }) => id);
  }

  /** The subjects whose flag list names hello_world. One request at a time: hundreds at once reset connections. */
  async function whoGets(subjects: string[]): Promise<Set<string>> {
    const on = new Set<string>();
    for (const subject of subjects) {
      // oxlint-disable-next-line no-await-in-loop -- deliberately sequential, see above.
      const { body } = await get(FLAGS, await portal(subject));
      if (body.hello_world === true) on.add(subject);
    }
    return on;
  }

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    t.idp.reset();
    vi.restoreAllMocks();
    await Promise.all([t.database.db.delete(featureFlags), t.database.db.delete(principals)]);
    clearFlagCache();
  });

  it('Should omit an off flag from a signed-in resident’s list and answer hello-world with 404 (AE1)', async () => {
    await seed(['resident-1']);
    await helloWorld({ enabled: false });
    const token = await portal('resident-1');
    const list = await get(FLAGS, token);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({});
    expect((await get(HELLO, token)).status).toBe(404);
  });

  it('Should give a request with no token a flag on at 100% and hello-world’s message (AE2, R4)', async () => {
    await helloWorld();
    const list = await get(FLAGS);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ hello_world: true });
    const hello = await get(HELLO);
    expect(hello.status).toBe(200);
    expect(hello.body).toEqual({ message: 'Hello, world!' });
  });

  it('Should never give an anonymous request a flag at 50%, and give residents a stable, partial answer (AE3)', async () => {
    await helloWorld({ rolloutPct: 50 });
    expect((await get(FLAGS)).body).toEqual({});
    expect((await get(HELLO)).status).toBe(404);

    const subjects = residents(200);
    await seed(subjects);
    const first = await whoGets(subjects);
    expect(first.size).toBeGreaterThanOrEqual(70);
    expect(first.size).toBeLessThanOrEqual(130);
    expect(await whoGets(subjects)).toEqual(first);
  });

  it('Should keep every resident who had the flag at 50% when it is raised to 80% (AE4)', async () => {
    await helloWorld({ rolloutPct: 50 });
    const subjects = residents(200);
    await seed(subjects);
    const atHalf = await whoGets(subjects);
    await t.database.db.update(featureFlags).set({ rolloutPct: 80 }).where(eq(featureFlags.key, 'hello_world'));
    clearFlagCache();
    const atEighty = await whoGets(subjects);
    for (const subject of atHalf) expect(atEighty.has(subject)).toBe(true);
    expect(atEighty.size).toBeGreaterThan(atHalf.size);
  });

  it('Should keep an off flag from a resident with an "on" override (R3, kill switch)', async () => {
    const [x] = await seed(['resident-x']);
    await helloWorld({ enabled: false });
    await override(x ?? '', true);
    expect((await get(FLAGS, await portal('resident-x'))).body).toEqual({});
    expect((await get(HELLO, await portal('resident-x'))).status).toBe(404);
  });

  it('Should give a flag on at 0% to the resident with an "on" override and not to another resident (AE5)', async () => {
    const [x] = await seed(['resident-x', 'resident-y']);
    await helloWorld({ rolloutPct: 0 });
    await override(x ?? '', true);
    expect((await get(FLAGS, await portal('resident-x'))).body).toEqual({ hello_world: true });
    expect((await get(HELLO, await portal('resident-x'))).status).toBe(200);
    expect((await get(FLAGS, await portal('resident-y'))).body).toEqual({});
    expect((await get(HELLO, await portal('resident-y'))).status).toBe(404);
  });

  it('Should keep a flag on at 100% from the resident with an "off" override and give it to another (R3)', async () => {
    const [x] = await seed(['resident-x', 'resident-y']);
    await helloWorld();
    await override(x ?? '', false);
    expect((await get(FLAGS, await portal('resident-x'))).body).toEqual({});
    expect((await get(FLAGS, await portal('resident-y'))).body).toEqual({ hello_world: true });
  });

  it('Should restore an "on" override unchanged when its flag is turned off and back on (R3)', async () => {
    const [x] = await seed(['resident-x']);
    await helloWorld({ rolloutPct: 0 });
    await override(x ?? '', true);
    expect((await get(FLAGS, await portal('resident-x'))).body).toEqual({ hello_world: true });
    await setEnabled(false);
    expect((await get(FLAGS, await portal('resident-x'))).body).toEqual({});
    await setEnabled(true);
    expect((await get(FLAGS, await portal('resident-x'))).body).toEqual({ hello_world: true });
  });

  it('Should name only the flags that are on in a signed-out list (AE6, R6)', async () => {
    await Promise.all([flag('new_thing', { enabled: false }), helloWorld(), flag('half_way', { rolloutPct: 50 })]);
    expect((await get(FLAGS)).body).toEqual({ hello_world: true });
  });

  it('Should list a console flag at 100% to a console token and never to a portal token or no token (AE9)', async () => {
    await seed(['resident-1', 'idir-1']);
    await helloWorld({ audience: 'console' });
    expect((await get(FLAGS, await consoleUser('idir-1'))).body).toEqual({ hello_world: true });
    expect((await get(HELLO, await consoleUser('idir-1'))).status).toBe(200);
    expect((await get(FLAGS, await portal('resident-1'))).body).toEqual({});
    expect((await get(HELLO, await portal('resident-1'))).status).toBe(404);
    expect((await get(FLAGS)).body).toEqual({});
    expect((await get(HELLO)).status).toBe(404);
  });

  it.each(['portal', 'console'] as const)('Should list a both-audience flag to %s callers', async (app) => {
    await seed(['resident-1', 'idir-1']);
    await helloWorld({ audience: 'both' });
    const token = app === 'portal' ? await portal('resident-1') : await consoleUser('idir-1');
    expect((await get(FLAGS, token)).body).toEqual({ hello_world: true });
  });

  it('Should evaluate a portal token with no principal as signed out and log a warning without personal data (KTD4)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await Promise.all([helloWorld(), flag('half_way', { rolloutPct: 50 }), flag('off_flag', { enabled: false })]);
    const token = await portal('resident-never-signed-in');
    expect((await get(FLAGS, token)).body).toEqual({ hello_world: true });
    expect((await get(HELLO, token)).status).toBe(200);
    expect(warn).toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('resident-never-signed-in');
    expect(logged).not.toContain(t.idp.issuer);
  });

  it('Should give a console token with no principal an empty list and a hello-world 404 (KTD4)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await helloWorld({ audience: 'both' });
    const token = await consoleUser('idir-never-signed-in');
    expect((await get(FLAGS, token)).body).toEqual({});
    expect((await get(HELLO, token)).status).toBe(404);
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('idir-never-signed-in');
  });

  it('Should answer 403 to a service-account token from both routes', async () => {
    await helloWorld();
    const token = await t.idp.serviceAccountToken();
    expect((await get(FLAGS, token)).status).toBe(403);
    expect((await get(HELLO, token)).status).toBe(403);
  });

  it('Should serve a flag change made outside the console only once the 30-second cache expires', async () => {
    expect((await get(FLAGS)).body).toEqual({});
    await t.database.db.insert(featureFlags).values({ key: 'hello_world', enabled: true, rolloutPct: 100 });
    expect((await get(FLAGS)).body).toEqual({});
    const now = Date.now();
    const later = vi.spyOn(Date, 'now').mockReturnValue(now + 30_001);
    try {
      expect((await get(FLAGS)).body).toEqual({ hello_world: true });
    } finally {
      later.mockRestore();
    }
  });

  it('Should mark the list, the message and the 404 Cache-Control: private, no-store', async () => {
    await helloWorld();
    expect((await get(FLAGS)).headers['cache-control']).toBe('private, no-store');
    expect((await get(HELLO)).headers['cache-control']).toBe('private, no-store');
    await t.database.db.update(featureFlags).set({ enabled: false });
    clearFlagCache();
    const missing = await get(HELLO);
    expect(missing.status).toBe(404);
    expect(missing.headers['cache-control']).toBe('private, no-store');
  });

  it('Should describe both routes under the shared tag in the OpenAPI document', async () => {
    const { body } = await t.http().get('/api/docs-json');
    expect(body.paths[FLAGS].get.tags).toEqual(['shared']);
    expect(body.paths[HELLO].get.tags).toEqual(['shared']);
  });
});
