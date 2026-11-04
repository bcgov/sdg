import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import type { NotificationDatabase } from '../database/database.module.js';
import { migrationsFolder } from '../database/run-migrations.js';
import * as schema from '../database/schema/index.js';

export interface TestDatabase {
  /** Typed as the production database: PGlite and node-postgres share Drizzle's Postgres query API. */
  db: NotificationDatabase;
  close: () => Promise<void>;
}

/** In-process Postgres (PGlite) with the committed drizzle/ migrations applied. Create one per test file. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle({ client, schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- PGlite and node-postgres share Drizzle's pg query API; only $client differs.
  return { db: db as unknown as NotificationDatabase, close: () => client.close() };
}
