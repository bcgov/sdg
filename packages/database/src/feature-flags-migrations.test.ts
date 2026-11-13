import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { migrationsFolder, migrationsSchema } from './migrations-folder.js';
import * as schema from './schema/index.js';
import { featureFlagEvents, featureFlagOverrides, featureFlags, principals } from './schema/index.js';

/** The rejection of `query`, or undefined when it succeeds. */
function rejectionOf(query: PromiseLike<unknown>): Promise<unknown> {
  return Promise.resolve(query).then(
    () => undefined,
    (reason: unknown) => reason,
  );
}

describe('feature flag migrations', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let principalId = '';

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle({ client, schema, casing: 'snake_case' });
    await migrate(db, { migrationsFolder, migrationsSchema });
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await Promise.all([db.delete(featureFlags), db.delete(principals), db.delete(featureFlagEvents)]);
    const [principal] = await db.insert(principals).values({ displayName: 'Ada Lovelace' }).returning();
    if (!principal) throw new Error('principal insert returned no row');
    principalId = principal.id;
  });

  it('Should default a new flag to off, 100% and the portal audience (R1, KTD6)', async () => {
    // Raw SQL so the database defaults are exercised, not Drizzle's.
    const result = await db.execute(
      sql`insert into core.feature_flags (key) values ('hello_world') returning description, enabled, rollout_pct, audience`,
    );
    expect(result.rows).toEqual([{ description: null, enabled: false, rollout_pct: 100, audience: 'portal' }]);
  });

  it('Should reject a rollout percentage outside 0 to 100 and an unknown audience', async () => {
    const tooHigh = await rejectionOf(db.insert(featureFlags).values({ key: 'a', rolloutPct: 101 }));
    expect(tooHigh).toMatchObject({ cause: { code: '23514', constraint: 'feature_flags_rollout_pct_check' } });
    const admin = await rejectionOf(
      db.execute(sql`insert into core.feature_flags (key, audience) values ('b', 'admin')`),
    );
    expect(admin).toMatchObject({ cause: { code: '23514', constraint: 'feature_flags_audience_check' } });
    await db.insert(featureFlags).values([
      { key: 'zero', rolloutPct: 0, audience: 'console' },
      { key: 'full', rolloutPct: 100, audience: 'both' },
    ]);
    expect(await db.$count(featureFlags)).toBe(2);
  });

  it('Should remove overrides when their flag or their principal is deleted (R17, KTD6)', async () => {
    await db.insert(featureFlags).values([{ key: 'hello_world' }, { key: 'new_thing' }]);
    await db.insert(featureFlagOverrides).values([
      { flagKey: 'hello_world', userId: principalId, enabled: true },
      { flagKey: 'new_thing', userId: principalId, enabled: false },
    ]);
    await db.delete(featureFlags).where(eq(featureFlags.key, 'hello_world'));
    expect(await db.select().from(featureFlagOverrides)).toEqual([
      { flagKey: 'new_thing', userId: principalId, enabled: false },
    ]);
    await db.delete(principals).where(eq(principals.id, principalId));
    expect(await db.$count(featureFlagOverrides)).toBe(0);
  });

  it('Should reject an override for an unknown principal id (KTD6)', async () => {
    await db.insert(featureFlags).values({ key: 'hello_world' });
    const error = await rejectionOf(
      db.insert(featureFlagOverrides).values({ flagKey: 'hello_world', userId: crypto.randomUUID(), enabled: true }),
    );
    expect(error).toMatchObject({
      cause: { code: '23503', constraint: 'feature_flag_overrides_user_id_principals_id_fk' },
    });
  });

  it('Should keep a flag’s events after the flag is deleted (R19, KTD7)', async () => {
    await db.insert(featureFlags).values({ key: 'hello_world' });
    const actor = { flagKey: 'hello_world', actorPrincipalId: principalId, actorName: 'Ada Lovelace' };
    await db.insert(featureFlagEvents).values([
      { ...actor, action: 'created', changes: { enabled: { from: null, to: false } } },
      { ...actor, action: 'deleted', changes: { overridesRemoved: 2 } },
    ]);
    await db.delete(featureFlags);
    await db.delete(principals);
    const events = await db.select().from(featureFlagEvents).orderBy(featureFlagEvents.id);
    expect(events.map((event) => [event.action, event.subjectPrincipalId, event.changes])).toEqual([
      ['created', null, { enabled: { from: null, to: false } }],
      ['deleted', null, { overridesRemoved: 2 }],
    ]);
  });

  it('Should reject an unknown event action (KTD7)', async () => {
    const error = await rejectionOf(
      db.execute(
        sql`insert into core.feature_flag_events (flag_key, action, actor_principal_id, actor_name)
            values ('hello_world', 'renamed', ${principalId}, 'Ada')`,
      ),
    );
    expect(error).toMatchObject({ cause: { code: '23514', constraint: 'feature_flag_events_action_check' } });
  });
});
