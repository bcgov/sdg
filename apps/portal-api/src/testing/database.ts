import { PGlite } from '@electric-sql/pglite';
import { migrationsFolder, type PortalDatabase } from '@repo/portal-database';
import * as schema from '@repo/portal-database/schema';
import { installPgCronStub } from '@repo/portal-database/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

export interface TestDatabase {
  /** Typed as the production database: PGlite and node-postgres share Drizzle's Postgres query API. */
  db: PortalDatabase;
  close: () => Promise<void>;
}

/** In-process Postgres (PGlite) with the real @repo/portal-database migrations applied (pg_cron stubbed). */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  await installPgCronStub(client);
  const db = drizzle({ client, schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- PGlite and node-postgres share Drizzle's pg query API; only $client differs.
  return { db: db as unknown as PortalDatabase, close: () => client.close() };
}
