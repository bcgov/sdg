import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { generateDrizzleJson, generateMigration, type DrizzleSnapshotJSON } from 'drizzle-kit/api';
import { eq, sql } from 'drizzle-orm';
import { CasingCache } from 'drizzle-orm/casing';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from './schema/index.js';
import { identities, principals, sessions } from './schema/index.js';
import { installPgCronStub } from './testing/index.js';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

type Journal = { entries: { idx: number; tag: string }[] };

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isJournal(value: unknown): value is Journal {
  return typeof value === 'object' && value !== null && 'entries' in value && Array.isArray(value.entries);
}

function isPgSnapshot(value: unknown): value is DrizzleSnapshotJSON {
  return typeof value === 'object' && value !== null && 'dialect' in value && value.dialect === 'postgresql';
}

function readJournal(): Journal {
  const journal = readJson(join(migrationsFolder, 'meta/_journal.json'));
  if (!isJournal(journal)) throw new Error(`Malformed ${migrationsFolder}/meta/_journal.json`);
  return journal;
}

function readLatestSnapshot(): DrizzleSnapshotJSON {
  const latest = readJournal().entries.at(-1);
  if (!latest) throw new Error(`No migrations in ${migrationsFolder}/meta/_journal.json`);
  const file = join(migrationsFolder, 'meta', `${String(latest.idx).padStart(4, '0')}_snapshot.json`);
  const snapshot = readJson(file);
  if (!isPgSnapshot(snapshot)) throw new Error(`Malformed snapshot ${file}`);
  return snapshot;
}

/** `table.column:notNull` and index names as the schema declares them (snake_case, like the client). */
function describeSchema(): { columns: string[]; indexes: string[] } {
  const casing = new CasingCache('snake_case');
  const configs = [principals, identities, sessions].map((table) => getTableConfig(table));
  return {
    columns: configs.flatMap((config) =>
      config.columns.map((column) => `${config.name}.${casing.getColumnCasing(column)}:${column.notNull}`),
    ),
    indexes: configs.flatMap((config) => config.indexes.map((index) => index.config.name ?? '')),
  };
}

describe('portal-database migrations', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeAll(async () => {
    client = new PGlite();
    await installPgCronStub(client);
    db = drizzle({ client, schema, casing: 'snake_case' });
    await migrate(db, { migrationsFolder });
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  /** Runs a scheduled job's command now, as pg_cron would. */
  async function runJob(name: string): Promise<void> {
    const job = await db.execute<{ command: string }>(sql`select command from cron.job where jobname = ${name}`);
    const command = job.rows[0]?.command;
    if (!command) throw new Error(`No cron job ${name}`);
    await client.exec(command);
  }

  describe('migration chain', () => {
    it('applies every migration to an empty database', async () => {
      const tables = await db.execute<{ table_name: string }>(
        sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual(['identities', 'principals', 'sessions']);
      const applied = await db.execute<{ count: number }>(
        sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
      );
      expect(applied.rows[0]?.count).toBe(readJournal().entries.length);
    });

    it('leaves no schema drift against src/schema', async () => {
      const latest = readLatestSnapshot();
      const current = generateDrizzleJson(schema, latest.id, undefined, 'snake_case');
      expect(await generateMigration(latest, current)).toEqual([]);
      // The migrated database itself must expose exactly the schema's columns, nullability and indexes.
      const expected = describeSchema();
      const columns = await db.execute<{ table_name: string; column_name: string; is_nullable: string }>(
        sql`select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public'`,
      );
      const actual = columns.rows.map((row) => `${row.table_name}.${row.column_name}:${row.is_nullable === 'NO'}`);
      expect(actual.toSorted()).toEqual(expected.columns.toSorted());
      const indexes = await db.execute<{ indexname: string }>(
        sql`select indexname from pg_indexes where schemaname = 'public' and indexname not like '%_pkey'`,
      );
      expect(indexes.rows.map((row) => row.indexname).toSorted()).toEqual(expected.indexes.toSorted());
    }, 60_000);
  });

  describe('pg_cron jobs', () => {
    it('schedules expired-session pruning and run-detail purging', async () => {
      const jobs = await db.execute<{ jobname: string; schedule: string; command: string }>(
        sql`select jobname, schedule, command from cron.job order by jobname`,
      );
      expect(jobs.rows).toEqual([
        { jobname: 'prune-expired-sessions', schedule: '*/15 * * * *', command: expect.stringContaining('sessions') },
        {
          jobname: 'purge-cron-run-details',
          schedule: '0 3 * * *',
          command: expect.stringContaining('job_run_details'),
        },
      ]);
    });

    it('prune-expired-sessions deletes only expired sessions', async () => {
      const now = Date.now();
      await db.insert(sessions).values([
        { sid: 'expired', sess: 'x', expiresAt: new Date(now - 1000) },
        { sid: 'live', sess: 'x', expiresAt: new Date(now + 60_000) },
      ]);
      await runJob('prune-expired-sessions');
      const left = await db.select({ sid: sessions.sid }).from(sessions);
      expect(left).toEqual([{ sid: 'live' }]);
      await db.delete(sessions);
    });

    it('purge-cron-run-details deletes runs older than a week', async () => {
      await db.execute(sql`insert into cron.job_run_details (end_time) values
        (now() - interval '8 days'), (now() - interval '1 day')`);
      await runJob('purge-cron-run-details');
      expect((await db.execute(sql`select runid from cron.job_run_details`)).rows).toHaveLength(1);
    });
  });

  describe('constraints', () => {
    let principalId = '';

    beforeEach(async () => {
      await db.delete(principals);
      const [principal] = await db.insert(principals).values({ displayName: 'Ada Lovelace' }).returning();
      if (!principal) throw new Error('principal insert returned no row');
      principalId = principal.id;
    });

    it('rejects a second identity with the same issuer and subject', async () => {
      const identity = { principalId, issuer: 'https://idp.example/realms/portal', subject: 'abc' };
      await db.insert(identities).values(identity);
      const error: unknown = await db
        .insert(identities)
        .values(identity)
        .then(
          () => undefined,
          (reason: unknown) => reason,
        );
      expect(error).toMatchObject({ cause: { code: '23505', constraint: 'identities_issuer_subject_key' } });
      expect(await db.$count(identities)).toBe(1);
    });

    it('allows the same subject under a different issuer', async () => {
      await db.insert(identities).values([
        { principalId, issuer: 'https://a.example/realms/portal', subject: 'abc' },
        { principalId, issuer: 'https://b.example/realms/portal', subject: 'abc' },
      ]);
      expect(await db.$count(identities, eq(identities.subject, 'abc'))).toBe(2);
    });

    it('deletes identities when their principal is deleted', async () => {
      await db.insert(identities).values({ principalId, issuer: 'https://idp.example', subject: 'abc' });
      expect(await db.$count(identities)).toBe(1);
      await db.delete(principals).where(eq(principals.id, principalId));
      expect(await db.$count(identities)).toBe(0);
    });

    it('generates uuids and timestamps by default', async () => {
      // Raw SQL so the database defaults are exercised, not Drizzle's runtime $onUpdate.
      const result = await db.execute<{ id: string; created_at: string; updated_at: string; claims: unknown }>(
        sql`insert into identities (principal_id, issuer, subject) values (${principalId}, 'https://idp.example', 'xyz')
            returning id, created_at, updated_at, email_verified, claims`,
      );
      const row = result.rows[0];
      expect(row?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(Number.isNaN(Date.parse(row?.created_at ?? ''))).toBe(false);
      expect(row?.updated_at).toBe(row?.created_at);
      expect(row).toMatchObject({ email_verified: false, claims: {} });

      const [principal] = await db.select().from(principals).where(eq(principals.id, principalId));
      expect(principal?.createdAt).toBeInstanceOf(Date);
      expect(principal).toMatchObject({ email: null, lastLoginAt: null });
    });

    it('bumps updated_at on update through Drizzle', async () => {
      const [before] = await db.select().from(principals).where(eq(principals.id, principalId));
      await new Promise((resolve) => setTimeout(resolve, 5));
      const [after] = await db
        .update(principals)
        .set({ displayName: 'Ada King' })
        .where(eq(principals.id, principalId))
        .returning();
      expect(after?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? Infinity);
    });
  });
});
