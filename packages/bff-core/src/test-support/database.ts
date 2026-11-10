import { PGlite } from '@electric-sql/pglite';
import { installPgCronStub } from '@repo/database/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { sessionMigrationsFolder } from '../migrations/migrations-folder.js';
import type { SessionDatabase } from '../session/session-database.js';
import { sessions } from '../session/sessions.schema.js';

export interface TestSessionDatabase {
  /** Typed as the production database: PGlite and node-postgres share Drizzle's Postgres query API. */
  db: SessionDatabase;
  client: PGlite;
  close: () => Promise<void>;
}

/** In-process Postgres (PGlite) with the real sessions migrations applied, as the superuser into `public`. */
export async function createTestSessionDatabase(): Promise<TestSessionDatabase> {
  const client = new PGlite();
  await installPgCronStub(client);
  const db = drizzle({ client, schema: { sessions }, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: sessionMigrationsFolder, migrationsSchema: 'public' });
  return { db, client, close: () => client.close() };
}
