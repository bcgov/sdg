import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDatabase } from './client.js';
import { parseDatabaseUrl, redactDatabaseError } from './database-url.js';
import { migrationsFolder, migrationsSchema } from './migrations-folder.js';

/** A failed migration run. The message names the target host and database, never the credentials. */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/**
 * Applies the committed drizzle-kit migrations with drizzle-orm's node-postgres migrator. It shares
 * `core.__drizzle_migrations` with `drizzle-kit migrate`, so either runner sees the other's work.
 * Resolves when nothing is pending; rejects with a {@link MigrationError} otherwise.
 */
export async function runMigrations(databaseUrl: string | undefined): Promise<void> {
  const url = parseDatabaseUrl(databaseUrl, (message) => new MigrationError(message));
  const target = `${url.host}${url.pathname}`;
  const db = createDatabase(
    { connectionString: url.href, max: 1, connectionTimeoutMillis: 10_000 },
    {
      // Logged with the credentials masked; a later query on the dropped connection fails and ends the run.
      onIdleClientError: (error) =>
        console.error(`database migrate: idle client error: ${redactDatabaseError(error, url)}`),
    },
  );
  try {
    await migrate(db, { migrationsFolder, migrationsSchema });
  } catch (error) {
    // The original error is not attached as `cause`: pg errors can carry the connection string.
    throw new MigrationError(`Migrating ${target} failed: ${redactDatabaseError(error, url)}`);
  } finally {
    await db.$client.end();
  }
}
