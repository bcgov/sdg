import { identities, principals } from '@repo/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';

const SEARCH = '/api/v1/console/people/search';

interface Person {
  name: string;
  email?: string | null;
  portalAt?: Date;
  consoleAt?: Date;
}

const names = (res: { body: { results: { displayName: string }[] } }) =>
  res.body.results.map((result) => result.displayName);

describe('POST /api/v1/console/people/search (R18, R20, KTD9)', () => {
  let t: TestApp;
  let token: string;
  let seq = 0;

  const search = (body: object, bearer = token) =>
    t.http().post(SEARCH).set('Authorization', `Bearer ${bearer}`).send(body);
  /** Each result as [displayName, kind, lastSignInAt]. */
  const summaries = async (query: string, audience: string) =>
    (await search({ query, audience })).body.results.map(
      (result: { displayName: string; kind: string; lastSignInAt: string }) => [
        result.displayName,
        result.kind,
        result.lastSignInAt,
      ],
    );

  /** A principal with one identity carrying the given sign-in markers (KTD5). */
  const seed = async ({ name, email = null, portalAt, consoleAt }: Person): Promise<string> => {
    seq += 1;
    const subject = `seed-${seq}`;
    const [principal] = await t.database.db
      .insert(principals)
      .values({ displayName: name, email })
      .returning({ id: principals.id });
    if (!principal) throw new Error('Seeding the principal returned no row');
    await t.database.db.insert(identities).values({
      principalId: principal.id,
      issuer: 'https://idp.test',
      subject,
      portalSignedInAt: portalAt ?? null,
      consoleSignedInAt: consoleAt ?? null,
    });
    return principal.id;
  };

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    t.idp.reset();
    await t.database.db.delete(principals);
    token = await t.idp.consoleToken(['admin']);
  });

  it('Should find a person by partial name and by partial email, case-insensitively', async () => {
    const portalAt = new Date('2026-11-01T10:00:00.000Z');
    const id = await seed({ name: 'Ada Lovelace', email: 'ada.lovelace@example.com', portalAt });
    await seed({ name: 'Grace Hopper', email: 'grace@example.com', portalAt });

    const byName = await search({ query: 'ada', audience: 'portal' });
    expect(byName.status).toBe(200);
    expect(byName.body).toEqual({
      results: [
        {
          principalId: id,
          displayName: 'Ada Lovelace',
          email: 'ada.lovelace@example.com',
          kind: 'resident',
          lastSignInAt: '2026-11-01T10:00:00.000Z',
        },
      ],
      more: false,
    });
    expect(names(await search({ query: 'LOVELACE@', audience: 'portal' }))).toEqual(['Ada Lovelace']);
  });

  it.each([['a'], [' a '], ['   ']])(
    'Should answer 400 to the query %j, under 2 characters once trimmed',
    async (query) => {
      expect((await search({ query, audience: 'portal' })).status).toBe(400);
    },
  );

  it('Should answer 400 to an unknown audience', async () => {
    expect((await search({ query: 'ada', audience: 'everyone' })).status).toBe(400);
  });

  it('Should match _, % and \\ only literally', async () => {
    const portalAt = new Date();
    await seed({ name: 'J Smith', email: 'j_smith@example.com', portalAt });
    await seed({ name: 'Jay Smith', email: 'jxsmith@example.com', portalAt });
    await seed({ name: '100% Sure', portalAt });
    await seed({ name: '100 Sure', portalAt });
    await seed({ name: 'Ab Backslash', portalAt });
    await seed({ name: 'A\\b Backslash', portalAt });

    expect(names(await search({ query: 'j_smith', audience: 'portal' }))).toEqual(['J Smith']);
    expect(names(await search({ query: '0%', audience: 'portal' }))).toEqual(['100% Sure']);
    expect(names(await search({ query: 'a\\b', audience: 'portal' }))).toEqual(['A\\b Backslash']);
  });

  it('Should filter by audience and label each result with its kind (AE10)', async () => {
    const portalAt = new Date('2026-11-02T00:00:00.000Z');
    const consoleAt = new Date('2026-11-03T00:00:00.000Z');
    await seed({ name: 'Sam Resident', portalAt });
    await seed({ name: 'Sam Staff', consoleAt });

    expect(await summaries('sam', 'portal')).toEqual([['Sam Resident', 'resident', portalAt.toISOString()]]);
    expect(await summaries('sam', 'console')).toEqual([['Sam Staff', 'console-user', consoleAt.toISOString()]]);
    expect(await summaries('sam', 'both')).toEqual([
      ['Sam Resident', 'resident', portalAt.toISOString()],
      ['Sam Staff', 'console-user', consoleAt.toISOString()],
    ]);
  });

  it("Should label someone who signed in to both apps as the override list does, by the flag's app (AE10)", async () => {
    const portalAt = new Date('2026-11-02T00:00:00.000Z');
    const consoleAt = new Date('2026-11-04T00:00:00.000Z');
    await seed({ name: 'Kim Both', portalAt, consoleAt });
    expect(await summaries('kim', 'portal')).toEqual([['Kim Both', 'resident', portalAt.toISOString()]]);
    expect(await summaries('kim', 'console')).toEqual([['Kim Both', 'console-user', consoleAt.toISOString()]]);
    expect(await summaries('kim', 'both')).toEqual([['Kim Both', 'console-user', consoleAt.toISOString()]]);
  });

  it('Should not return a principal who has no sign-in marker (KTD5)', async () => {
    await seed({ name: 'Old Timer' });
    const bodies = await Promise.all(
      ['portal', 'console', 'both'].map(async (audience) => (await search({ query: 'old', audience })).body),
    );
    for (const body of bodies) expect(body).toEqual({ results: [], more: false });
  });

  it('Should return 20 results and more: true for 21 matches', async () => {
    const consoleAt = new Date();
    await Promise.all(
      Array.from({ length: 21 }, (_, n) => seed({ name: `Pat ${String(n + 1).padStart(2, '0')}`, consoleAt })),
    );

    const res = await search({ query: 'pat', audience: 'console' });
    expect(res.body.results).toHaveLength(20);
    expect(res.body.more).toBe(true);
    expect(names(res).at(-1)).toBe('Pat 20');
  });

  it('Should answer 403 to a console user without the admin role and to a portal user (R20)', async () => {
    await seed({ name: 'Ada Lovelace', portalAt: new Date() });
    expect((await search({ query: 'ada', audience: 'portal' }, await t.idp.consoleToken(['viewer']))).status).toBe(403);
    expect((await search({ query: 'ada', audience: 'portal' }, await t.idp.portalToken())).status).toBe(403);
  });
});
