import { PGlite } from '@electric-sql/pglite';
import { migrationsFolder } from '@repo/notification-database';
import * as schema from '@repo/notification-database/schema';
import { migrateTestDatabase } from '@repo/notification-database/testing';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { Client, escapeIdentifier } from 'pg';

import type { NotificationDatabase } from '../database/database.module.js';
import type { InboxSignals } from '../inbox/signals/inbox-signals.js';
import { PgliteInboxSignals } from '../inbox/signals/pglite-inbox-signals.js';

export interface TestDatabase {
  /** Typed as the production database: PGlite and node-postgres share Drizzle's Postgres query API. */
  db: NotificationDatabase;
  /** Inbox change signals listening on this database; without them the app's own listener uses DATABASE_URL. */
  signals?: InboxSignals;
  close: () => Promise<void>;
}

/**
 * In-process Postgres (PGlite) with the committed @repo/notification-database migrations applied, and inbox change
 * signals listening on it. Create one per test file.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle({ client, schema, casing: 'snake_case' });
  await migrateTestDatabase(db);
  const signals = await PgliteInboxSignals.listen(client);
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- PGlite and node-postgres share Drizzle's pg query API; only $client differs.
    db: db as unknown as NotificationDatabase,
    signals,
    close: async () => {
      await signals.close();
      await client.close();
    },
  };
}

/**
 * Creates the database `target` names on a real Postgres server (through its `postgres` database, so the user must
 * be allowed to create databases) and applies the committed @repo/notification-database migrations to it, for the
 * `*.pg.test.ts` files.
 */
export async function createPostgresTestDatabase(target: URL): Promise<void> {
  const maintenance = new URL(target.href);
  maintenance.pathname = '/postgres';
  const admin = new Client({ connectionString: maintenance.href });
  await admin.connect();
  try {
    await admin.query(`create database ${escapeIdentifier(decodeURIComponent(target.pathname.slice(1)))}`);
  } finally {
    await admin.end();
  }
  const client = new Client({ connectionString: target.href });
  await client.connect();
  try {
    await migrate(drizzleNodePg({ client }), { migrationsFolder });
  } finally {
    await client.end();
  }
}
