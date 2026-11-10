import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { installPgCronStub } from '@repo/database/testing';
import { generateDrizzleJson, generateMigration, type DrizzleSnapshotJSON } from 'drizzle-kit/api';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sessions } from '../session/sessions.schema.js';
import { sessionMigrationsFolder } from './migrations-folder.js';
import { runSessionMigrations, SessionMigrationError } from './run-session-migrations.js';

const LOGINS = ['portal', 'admin'] as const;
type Login = (typeof LOGINS)[number];

function isPgSnapshot(value: unknown): value is DrizzleSnapshotJSON {
  return typeof value === 'object' && value !== null && 'dialect' in value && value.dialect === 'postgresql';
}

function readJournalTags(): string[] {
  const journal: unknown = JSON.parse(readFileSync(join(sessionMigrationsFolder, 'meta/_journal.json'), 'utf8'));
  if (typeof journal !== 'object' || journal === null || !('entries' in journal) || !Array.isArray(journal.entries)) {
    throw new Error('Malformed sessions journal');
  }
  return journal.entries.map((entry: { tag: string }) => entry.tag);
}

/**
 * compose's dev Postgres as set up (packages/database/dev-postgres/init-roles.sql): each BFF login owns the
 * schema of its name and may use the cron schema. The pg_cron stub's job table is a plain table, so the logins also
 * get the table rights the real extension grants through its own functions.
 */
const CLUSTER_SQL = `
SET search_path TO "$user", public;
CREATE ROLE portal LOGIN;
CREATE ROLE admin LOGIN;
DO $$ BEGIN EXECUTE format('GRANT ALL ON DATABASE %I TO portal, admin', current_database()); END $$;
CREATE SCHEMA portal AUTHORIZATION portal;
CREATE SCHEMA admin AUTHORIZATION admin;
GRANT USAGE ON SCHEMA cron TO portal, admin;
GRANT SELECT, INSERT, UPDATE ON cron.job TO portal, admin;
GRANT USAGE ON SEQUENCE cron.job_jobid_seq TO portal, admin;
`;

describe('sessions migrations', () => {
  let client: PGlite;

  async function asLogin(login: Login, run: () => Promise<unknown>): Promise<void> {
    await client.exec(`SET ROLE ${login}`);
    try {
      await run();
    } finally {
      await client.exec('RESET ROLE');
    }
  }

  const migrateAs = (login: Login) =>
    asLogin(login, () =>
      migrate(drizzle({ client }), { migrationsFolder: sessionMigrationsFolder, migrationsSchema: login }),
    );

  beforeAll(async () => {
    client = new PGlite();
    await installPgCronStub(client);
    await client.exec(CLUSTER_SQL);
    // One after the other: both switch roles on the one PGlite connection.
    await migrateAs('portal');
    await migrateAs('admin');
  }, 60_000);

  afterAll(() => client.close());

  it('creates a sessions table and a migrations journal in each login schema, and nothing in public', async () => {
    const tables = await client.query<{ table_schema: string; table_name: string }>(
      `select table_schema, table_name from information_schema.tables
       where table_schema in ('portal', 'admin', 'public', 'drizzle') order by table_schema, table_name`,
    );
    expect(tables.rows).toEqual([
      { table_schema: 'admin', table_name: '__drizzle_migrations' },
      { table_schema: 'admin', table_name: 'sessions' },
      { table_schema: 'portal', table_name: '__drizzle_migrations' },
      { table_schema: 'portal', table_name: 'sessions' },
    ]);
    const owners = await client.query<{ schemaname: string; tableowner: string }>(
      `select schemaname, tableowner from pg_tables where tablename = 'sessions' order by schemaname`,
    );
    expect(owners.rows).toEqual([
      { schemaname: 'admin', tableowner: 'admin' },
      { schemaname: 'portal', tableowner: 'portal' },
    ]);
  });

  it('schedules a distinctly named prune job per login, over its own table', async () => {
    const jobs = await client.query<{ jobname: string; schedule: string; command: string }>(
      'select jobname, schedule, command from cron.job order by jobname',
    );
    expect(jobs.rows).toEqual([
      {
        jobname: 'admin-prune-expired-sessions',
        schedule: '*/15 * * * *',
        command: 'DELETE FROM admin.sessions WHERE expires_at <= now()',
      },
      {
        jobname: 'portal-prune-expired-sessions',
        schedule: '*/15 * * * *',
        command: 'DELETE FROM portal.sessions WHERE expires_at <= now()',
      },
    ]);
  });

  it('applies nothing on a second run', async () => {
    await migrateAs('portal');
    const applied = await client.query<{ count: number }>(
      'select count(*)::int as count from portal.__drizzle_migrations',
    );
    expect(applied.rows[0]?.count).toBe(readJournalTags().length);
    expect((await client.query('select from cron.job')).rows).toHaveLength(2);
  });

  it('keeps each login out of the other login sessions', async () => {
    await expect(asLogin('admin', () => client.query('select from portal.sessions'))).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('prune deletes expired sessions and expired tombstones, and keeps live ones and fresh tombstones', async () => {
    await asLogin('portal', () =>
      client.exec(`insert into sessions (sid, sess, expires_at, destroyed_at) values
        ('expired', 'x', now() - interval '1 second', null),
        ('expired-tombstone', '', now() - interval '1 second', now() - interval '1 hour'),
        ('tombstone', '', now() + interval '1 hour', now()),
        ('live', 'x', now() + interval '1 hour', null)`),
    );
    const [job] = (
      await client.query<{ command: string }>(
        `select command from cron.job where jobname = 'portal-prune-expired-sessions'`,
      )
    ).rows;
    await asLogin('portal', () => client.exec(job?.command ?? ''));
    const left = await client.query<{ sid: string }>('select sid from portal.sessions order by sid');
    expect(left.rows).toEqual([{ sid: 'live' }, { sid: 'tombstone' }]);
  });

  it('leaves no schema drift against src/session/sessions.schema.ts', async () => {
    const tags = readJournalTags();
    const snapshotFile = join(
      sessionMigrationsFolder,
      'meta',
      `${String(tags.length - 1).padStart(4, '0')}_snapshot.json`,
    );
    const latest: unknown = JSON.parse(readFileSync(snapshotFile, 'utf8'));
    if (!isPgSnapshot(latest)) throw new Error(`Malformed snapshot ${snapshotFile}`);
    const current = generateDrizzleJson({ sessions }, latest.id, undefined, 'snake_case');
    expect(await generateMigration(latest, current)).toEqual([]);
    const columns = await client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
       where table_schema = 'portal' and table_name = 'sessions' order by column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'destroyed_at', is_nullable: 'YES' },
      { column_name: 'expires_at', is_nullable: 'NO' },
      { column_name: 'sess', is_nullable: 'NO' },
      { column_name: 'sid', is_nullable: 'NO' },
    ]);
  }, 60_000);
});

describe('runSessionMigrations', () => {
  const options = { migrationsSchema: 'portal' };

  it('rejects a missing, invalid or non-postgres DATABASE_URL without echoing it', async () => {
    await expect(runSessionMigrations(undefined, options)).rejects.toThrow('DATABASE_URL is not set.');
    await expect(runSessionMigrations('not a url', options)).rejects.toThrow('DATABASE_URL is not a valid URL.');
    const error = await runSessionMigrations('mysql://portal:s3cret-pw@db:3306/portal', options).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SessionMigrationError);
    expect(String(error)).toContain('must use postgres:// or postgresql://');
    expect(String(error)).not.toContain('s3cret-pw');
  });

  it('rejects an unreachable database without leaking the password', async () => {
    // Port 1 on loopback refuses immediately, so no real database is needed.
    const error = await runSessionMigrations('postgres://portal:s3cret%2Fpw@127.0.0.1:1/portal', options).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SessionMigrationError);
    if (!(error instanceof SessionMigrationError)) return;
    expect(error.message).toMatch(/^Migrating sessions on 127\.0\.0\.1:1\/portal failed: /);
    expect(error.message).toContain('ECONNREFUSED');
    expect(error.message).not.toMatch(/s3cret/);
    expect(error.cause).toBeUndefined();
  });
});
