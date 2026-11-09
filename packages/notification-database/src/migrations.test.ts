import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { generateDrizzleJson, generateMigration, type DrizzleSnapshotJSON } from 'drizzle-kit/api';
import { is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrationsFolder } from './migrations-folder.js';
import * as schema from './schema/index.js';
import { migrateTestDatabase } from './testing/index.js';

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

/** Every table the schema declares. */
const declaredTables = Object.values(schema).flatMap((value) => (is(value, PgTable) ? [getTableConfig(value)] : []));

describe('notification-database migrations', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle({ client, schema, casing: 'snake_case' });
    await migrateTestDatabase(db);
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  async function tablesIn(schemaName: string): Promise<string[]> {
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = ${schemaName} order by table_name`,
    );
    return result.rows.map((row) => row.table_name);
  }

  it('creates every table in the notification schema and none in public', async () => {
    expect(declaredTables.map((table) => table.schema)).toEqual(declaredTables.map(() => 'notification'));
    expect(await tablesIn('notification')).toEqual(declaredTables.map((table) => table.name).toSorted());
    expect(await tablesIn('public')).toEqual([]);
  });

  it('is one baseline that creates the schema first and never names public', () => {
    expect(readJournal().entries.map((entry) => entry.tag)).toEqual(['0000_init']);
    const baseline = readFileSync(join(migrationsFolder, '0000_init.sql'), 'utf8');
    expect(baseline.trimStart()).toMatch(/^CREATE SCHEMA "notification";/);
    expect(baseline).not.toContain('"public"');
  });

  it('records each migration once, and applying again changes nothing', async () => {
    const count = async (): Promise<number | undefined> =>
      (await db.execute<{ count: number }>(sql`select count(*)::int as count from drizzle.__drizzle_migrations`))
        .rows[0]?.count;
    expect(await count()).toBe(readJournal().entries.length);
    await migrateTestDatabase(db);
    expect(await count()).toBe(readJournal().entries.length);
  });

  it('leaves no drift against src/schema', async () => {
    const latest = readLatestSnapshot();
    const current = generateDrizzleJson(schema, latest.id, undefined, 'snake_case');
    expect(await generateMigration(latest, current)).toEqual([]);
  }, 60_000);
});
