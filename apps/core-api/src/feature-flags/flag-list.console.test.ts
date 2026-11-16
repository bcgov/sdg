import { featureFlagOverrides, featureFlags, principals, type NewFeatureFlag } from '@repo/database';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';

const FLAGS = '/api/v1/console/feature-flags';

/** `flag_000`, `flag_001`, … so key order is numeric order. */
const numbered = (count: number): NewFeatureFlag[] =>
  Array.from({ length: count }, (_, i) => ({ key: `flag_${String(i).padStart(3, '0')}` }));

describe('Console flag list GET /api/v1/console/feature-flags (R12, R14–R17)', () => {
  let t: TestApp;
  let token: string;

  const list = (query = '', bearer = token) =>
    t.http().get(`${FLAGS}${query}`).set('Authorization', `Bearer ${bearer}`);
  const keys = async (query: string): Promise<string[]> =>
    (await list(query)).body.items.map((flag: { key: string }) => flag.key);
  const seed = (flags: NewFeatureFlag[]) => t.database.db.insert(featureFlags).values(flags);

  /** Gives `flagKey` `on` overrides forced on and `off` forced off, each for a new principal. */
  async function overrides(flagKey: string, on: number, off: number): Promise<void> {
    const people = await t.database.db
      .insert(principals)
      .values(Array.from({ length: on + off }, (_, i) => ({ displayName: `${flagKey} person ${i}` })))
      .returning({ id: principals.id });
    await t.database.db
      .insert(featureFlagOverrides)
      .values(people.map(({ id }, i) => ({ flagKey, userId: id, enabled: i < on })));
  }

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    t.idp.reset();
    await Promise.all([t.database.db.delete(featureFlags), t.database.db.delete(principals)]);
    token = await t.idp.consoleToken(['admin']);
  });

  it('Should answer the first 20 flags by key with the total, and the remaining 5 at offset=20 (R12, R17)', async () => {
    await seed(numbered(25));
    const first = await list();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ total: 25, limit: 20, offset: 0 });
    expect(first.body.items.map((flag: { key: string }) => flag.key)).toEqual(numbered(20).map((flag) => flag.key));
    const second = await list('?offset=20');
    expect(second.body).toMatchObject({ total: 25, limit: 20, offset: 20 });
    expect(second.body.items.map((flag: { key: string }) => flag.key)).toEqual([
      'flag_020',
      'flag_021',
      'flag_022',
      'flag_023',
      'flag_024',
    ]);
  });

  it('Should answer each flag with its fields and its "on" and "off" override counts (R21)', async () => {
    await seed([
      { key: 'alpha', description: 'First', audience: 'both', enabled: true, rolloutPct: 40 },
      { key: 'zeta' },
    ]);
    await overrides('alpha', 2, 1);
    expect((await list()).body).toEqual({
      items: [
        {
          key: 'alpha',
          description: 'First',
          enabled: true,
          rolloutPct: 40,
          audience: 'both',
          overrideCounts: { on: 2, off: 1 },
        },
        {
          key: 'zeta',
          description: null,
          enabled: false,
          rolloutPct: 100,
          audience: 'portal',
          overrideCounts: { on: 0, off: 0 },
        },
      ],
      total: 2,
      limit: 20,
      offset: 0,
    });
  });

  it('Should search key or description case-insensitively, with _ matching only itself (R15, KTD4)', async () => {
    await seed([
      { key: 'new_checkout' },
      { key: 'banner', description: 'Shows the CHECK-in banner' },
      { key: 'unrelated', description: 'Nothing here' },
      { key: 'a_b' },
      { key: 'axb' },
    ]);
    expect(await keys('?q=check')).toEqual(['banner', 'new_checkout']);
    expect(await keys('?q=CHECK')).toEqual(['banner', 'new_checkout']);
    expect(await keys('?q=a_b')).toEqual(['a_b']);
    expect((await list('?q=check')).body.total).toBe(2);
  });

  it('Should filter by the app a flag affects and by its switch (R15)', async () => {
    await seed([
      { key: 'for_portal', audience: 'portal', enabled: true },
      { key: 'for_console', audience: 'console' },
      { key: 'for_both', audience: 'both', enabled: true },
    ]);
    expect(await keys('?audience=portal')).toEqual(['for_both', 'for_portal']);
    expect(await keys('?audience=console')).toEqual(['for_both', 'for_console']);
    expect(await keys('?enabled=false')).toEqual(['for_console']);
    expect(await keys('?enabled=true&audience=console')).toEqual(['for_both']);
  });

  it('Should sort by "on" overrides, most first, with ties by key, and page a tied column without repeats (AE3, R12, R16)', async () => {
    await seed([{ key: 'd_flag' }, { key: 'c_flag' }, { key: 'b_flag' }, { key: 'a_flag' }, { key: 'e_flag' }]);
    await Promise.all([overrides('c_flag', 3, 0), overrides('e_flag', 1, 5), overrides('a_flag', 1, 0)]);
    const sorted = ['c_flag', 'a_flag', 'e_flag', 'b_flag', 'd_flag'];
    expect(await keys('?sort=overridesOn')).toEqual(sorted);
    const pages = await Promise.all([0, 2, 4].map((offset) => keys(`?sort=overridesOn&limit=2&offset=${offset}`)));
    expect(pages.flat()).toEqual(sorted);
    expect(await keys('?sort=overridesOn&order=asc')).toEqual(['b_flag', 'd_flag', 'a_flag', 'e_flag', 'c_flag']);
  });

  it('Should sort by rollout, ascending on request, and by audience and switch (R16)', async () => {
    await seed([
      { key: 'half', rolloutPct: 50, audience: 'console', enabled: true },
      { key: 'none', rolloutPct: 0, audience: 'portal' },
      { key: 'full', rolloutPct: 100, audience: 'both' },
    ]);
    expect(await keys('?sort=rolloutPct&order=asc')).toEqual(['none', 'half', 'full']);
    expect(await keys('?sort=rolloutPct')).toEqual(['full', 'half', 'none']);
    expect(await keys('?sort=audience')).toEqual(['full', 'half', 'none']);
    expect(await keys('?sort=enabled&order=desc')).toEqual(['half', 'full', 'none']);
    expect(await keys('?sort=key&order=desc')).toEqual(['none', 'half', 'full']);
  });

  it('Should answer an offset past the end with the last page and the offset used (AE2, R14)', async () => {
    const flags = numbered(134);
    await seed(flags);
    const page7 = await list('?offset=120');
    expect(page7.body).toMatchObject({ total: 134, offset: 120 });
    expect(page7.body.items).toHaveLength(14);

    await t.database.db.delete(featureFlags).where(
      inArray(
        featureFlags.key,
        flags.slice(0, 20).map((flag) => flag.key),
      ),
    );
    const clamped = await list('?offset=120');
    expect(clamped.body).toMatchObject({ total: 114, limit: 20, offset: 100 });
    expect(clamped.body.items.map((flag: { key: string }) => flag.key)).toEqual(
      flags.slice(120).map((flag) => flag.key),
    );
  });

  it('Should answer an empty first page when nothing matches, at any offset (R14)', async () => {
    await seed(numbered(3));
    expect((await list('?q=nothing&offset=40')).body).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
    expect((await list('?q=nothing')).body).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
  });

  it.each([
    ['an unknown sort', '?sort=description'],
    ['an unknown audience', '?audience=both'],
    ['an unknown order', '?order=up'],
    ['a switch that is not true or false', '?enabled=yes'],
    ['a limit above 100', '?limit=101'],
    ['a negative offset', '?offset=-1'],
  ])('Should answer 400 to %s', async (_, query) => {
    expect((await list(query)).status).toBe(400);
  });

  it('Should answer 403 to a console token without admin (R20)', async () => {
    expect((await list('', await t.idp.consoleToken(['viewer']))).status).toBe(403);
  });

  it('Should describe the numbered page in the OpenAPI document (KTD2)', async () => {
    const { body } = await t.http().get('/api/docs-json');
    const parameters = body.paths[FLAGS].get.parameters.map((parameter: { name: string }) => parameter.name);
    expect(parameters).toEqual(
      expect.arrayContaining(['limit', 'offset', 'q', 'sort', 'order', 'audience', 'enabled']),
    );
    const schema = body.paths[FLAGS].get.responses['200'].content['application/json'].schema;
    expect(JSON.stringify(schema)).toContain('total');
  });
});
