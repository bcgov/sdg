import { PGlite } from '@electric-sql/pglite';
import { migrationsFolder, migrationsSchema, type Database } from '@repo/database';
import * as schema from '@repo/database/schema';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

export interface TestDatabase {
  /** Typed as the production database: PGlite and node-postgres share Drizzle's Postgres query API. */
  db: Database;
  close: () => Promise<void>;
}

/** In-process Postgres (PGlite) with the real @repo/database migrations applied. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle({ client, schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder, migrationsSchema });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- PGlite and node-postgres share Drizzle's pg query API; only $client differs.
  return { db: db as unknown as Database, close: () => client.close() };
}
