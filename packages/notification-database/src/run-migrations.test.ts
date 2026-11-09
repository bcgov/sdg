import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { migrationsFolder } from './migrations-folder.js';
import { MIGRATION_LOCK_KEY, MigrationError, runMigrations } from './run-migrations.js';

/** The tags drizzle-kit wrote to the journal, in order. */
function journalTags(): string[] {
  const journal: { entries: { tag: string }[] } = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  );
  return journal.entries.map((entry) => entry.tag);
}

const SCHEMA_QUERY = `
  select table_schema, table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema not in ('pg_catalog', 'information_schema')
  order by table_schema, table_name, ordinal_position`;

describe('runMigrations', () => {
  it('rejects a missing or invalid DATABASE_URL without echoing it', async () => {
    await expect(runMigrations(undefined)).rejects.toThrow(new MigrationError('DATABASE_URL is not set.'));
    await expect(runMigrations('')).rejects.toThrow('DATABASE_URL is not set.');
    await expect(runMigrations('not a url')).rejects.toThrow('DATABASE_URL is not a valid URL.');
    const error = await runMigrations('mysql://notification:s3cret-pw@db.internal/notification').catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MigrationError);
    expect(String(error)).toContain('must use postgres:// or postgresql://');
    expect(String(error)).not.toContain('s3cret-pw');
    await expect(runMigrations('postgres://notification:pw@db.internal:5432')).rejects.toThrow('must name a database');
  });

  it('rejects an unreachable server without leaking the password', async () => {
    // Port 1 on loopback refuses immediately, so no real database is needed.
    const error = await runMigrations('postgres://notification:s3cret%2Fpw@127.0.0.1:1/notification').catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MigrationError);
    if (!(error instanceof MigrationError)) return;
    expect(error.message).toMatch(/^Migrating 127\.0\.0\.1:1\/notification failed: /);
    expect(error.message).toContain('ECONNREFUSED');
    expect(error.message).not.toMatch(/s3cret/);
    expect(error.cause).toBeUndefined();
  });
});

async function withClient<T>(url: URL | string, use: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

async function query<T>(url: URL, text: string): Promise<T[]> {
  return withClient(url, async (client) => (await client.query(text)).rows);
}

// Needs a real Postgres whose user may create databases, e.g. the compose one:
// NOTIFICATION_TEST_DATABASE_URL=postgres://portal:portal@localhost:5432/portal pnpm --filter @repo/notification-database test
const serverUrl = process.env['NOTIFICATION_TEST_DATABASE_URL'];

async function createDatabase(url: URL): Promise<void> {
  await withClient(serverUrl ?? '', (admin) => admin.query(`create database "${url.pathname.slice(1)}"`));
}

describe.skipIf(!serverUrl)('runMigrations on Postgres', () => {
  const prefix = `notification_migrate_test_${process.pid}_${Date.now()}`;
  const created: string[] = [];

  /** A URL for a fresh database name on the test server; dropped after the suite. */
  function databaseUrl(suffix: string): URL {
    const name = `${prefix}_${suffix}`;
    created.push(name);
    const url = new URL(serverUrl ?? 'postgres://unset');
    url.pathname = `/${name}`;
    return url;
  }

  afterAll(async () => {
    await withClient(serverUrl ?? '', async (admin) => {
      await Promise.all(created.map((name) => admin.query(`drop database if exists "${name}" with (force)`)));
    });
  });

  it('creates the database, and a second run leaves the schema unchanged and records each migration once', async () => {
    const target = databaseUrl('rerun');
    const first = await runMigrations(target.href);
    expect(first).toEqual({ target: `${target.host}${target.pathname}`, databaseCreated: true });
    const schemaAfterFirst = await query(target, SCHEMA_QUERY);

    const second = await runMigrations(target.href);
    expect(second.databaseCreated).toBe(false);
    expect(await query(target, SCHEMA_QUERY)).toEqual(schemaAfterFirst);
    const hashes = await query<{ hash: string }>(target, 'select hash from drizzle.__drizzle_migrations');
    expect(hashes).toHaveLength(journalTags().length);
  });

  it('lets two runners started together both succeed, applying each migration once (AE4)', async () => {
    // The database exists, as under PGO; both runners race on the migrations alone.
    const target = databaseUrl('concurrent');
    await createDatabase(target);
    const results = await Promise.allSettled([runMigrations(target.href), runMigrations(target.href)]);
    expect(results.map((result) => (result.status === 'rejected' ? String(result.reason) : 'ok'))).toEqual([
      'ok',
      'ok',
    ]);
    const hashes = await query<{ hash: string }>(target, 'select hash from drizzle.__drizzle_migrations');
    expect(hashes).toHaveLength(journalTags().length);
  });

  it('gives up after the bounded wait with a message that names the lock and no credentials', async () => {
    const target = databaseUrl('locked');
    await createDatabase(target);
    await withClient(target, async (holder) => {
      await holder.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      const error = await runMigrations(target.href, { lockWaitMs: 300 }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(MigrationError);
      if (!(error instanceof MigrationError)) return;
      expect(error.message).toContain(`migration lock (pg_advisory_lock ${MIGRATION_LOCK_KEY})`);
      expect(error.message).toContain('0.3s');
      expect(error.message).not.toContain(target.href);
      expect(error.message).not.toContain(`:${target.password}@`);
    });
    // Nothing was applied while the lock was held.
    expect(await query(target, `select 1 from pg_namespace where nspname = 'notification'`)).toEqual([]);
  });
});
