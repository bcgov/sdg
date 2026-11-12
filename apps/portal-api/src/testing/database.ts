import { PGlite } from '@electric-sql/pglite';
import { sessions, type SessionDatabase } from '@repo/bff-core';
import { sessionMigrationsFolder } from '@repo/bff-core/migrations';
import { installPgCronStub } from '@repo/database/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

export interface TestDatabase {
  /** Typed as the production database: PGlite and node-postgres share Drizzle's Postgres query API. */
  db: SessionDatabase;
  close: () => Promise<void>;
}

/**
 * In-process Postgres (PGlite) with bff-core's real sessions migrations, applied as the superuser into `public`
 * (production applies them as the portal login into its own schema). The migration schedules its prune job through
 * pg_cron, which PGlite lacks, so a stub stands in for it.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  await installPgCronStub(client);
  const db = drizzle({ client, schema: { sessions }, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: sessionMigrationsFolder, migrationsSchema: 'public' });
  return { db, close: () => client.close() };
}
