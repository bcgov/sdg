import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createTestDatabase } from '../testing/database.js';
import { MigrationError, migrationsFolder, runMigrations } from './run-migrations.js';

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
    await expect(runMigrations('not a url')).rejects.toThrow('DATABASE_URL is not a valid URL.');
    const error = await runMigrations('mysql://notification:s3cret-pw@db.internal/notification').catch(
      (caught: unknown) => caught,
    );
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

describe('test database (PGlite)', () => {
  it('records each committed migration once', async () => {
    const { db, close } = await createTestDatabase();
    const applied = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    await close();
    expect(journalTags().length).toBeGreaterThan(0);
    expect(applied.rows[0]?.count).toBe(journalTags().length);
  });
});

// Needs a real Postgres whose user may create databases, e.g. the compose one:
// NOTIFICATION_TEST_DATABASE_URL=postgres://portal:portal@localhost:5432/portal pnpm --filter notification-api test
const serverUrl = process.env['NOTIFICATION_TEST_DATABASE_URL'];

describe.skipIf(!serverUrl)('runMigrations on Postgres', () => {
  const name = `notification_migrate_test_${process.pid}_${Date.now()}`;
  const target = new URL(serverUrl ?? 'postgres://unset');
  target.pathname = `/${name}`;

  async function query<T>(text: string): Promise<T[]> {
    const client = new Client({ connectionString: target.href });
    await client.connect();
    try {
      return (await client.query(text)).rows;
    } finally {
      await client.end();
    }
  }

  afterAll(async () => {
    const admin = new Client({ connectionString: serverUrl });
    await admin.connect();
    try {
      await admin.query(`drop database if exists "${name}" with (force)`);
    } finally {
      await admin.end();
    }
  });

  it('creates the database, and a second run leaves the schema unchanged and records each migration once', async () => {
    const first = await runMigrations(target.href);
    expect(first).toEqual({ target: `${target.host}/${name}`, databaseCreated: true });
    const schemaAfterFirst = await query(SCHEMA_QUERY);

    const second = await runMigrations(target.href);
    expect(second.databaseCreated).toBe(false);
    expect(await query(SCHEMA_QUERY)).toEqual(schemaAfterFirst);
    const hashes = await query<{ hash: string }>('select hash from drizzle.__drizzle_migrations order by created_at');
    expect(hashes).toHaveLength(journalTags().length);
  });
});
