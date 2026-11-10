import { parseDatabaseUrl, redactDatabaseError } from '@repo/database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { sessionMigrationsFolder } from './migrations-folder.js';

/** A failed sessions migration run. The message names the target host and database, never the credentials. */
export class SessionMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionMigrationError';
  }
}

export interface SessionMigrationOptions {
  /**
   * The migrating login's own schema (`portal`, `admin`), where drizzle keeps this BFF's journal
   * (`<schema>.__drizzle_migrations`), so it never collides with another login's journal.
   */
  readonly migrationsSchema: string;
}

/**
 * Applies the sessions migrations as the BFF's own login: the `sessions` table lands in that login's schema and the
 * login schedules its own `<login>-prune-expired-sessions` job. Run from each BFF image's session-migrate
 * entry (an initContainer). Resolves when nothing is pending; rejects with a {@link SessionMigrationError} otherwise.
 */
export async function runSessionMigrations(
  databaseUrl: string | undefined,
  options: SessionMigrationOptions,
): Promise<void> {
  const url = parseDatabaseUrl(databaseUrl, (message) => new SessionMigrationError(message));
  const target = `${url.host}${url.pathname}`;
  const pool = new Pool({ connectionString: url.href, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: sessionMigrationsFolder,
      migrationsSchema: options.migrationsSchema,
    });
  } catch (error) {
    // The original error is not attached as `cause`: pg errors can carry the connection string.
    throw new SessionMigrationError(`Migrating sessions on ${target} failed: ${redactDatabaseError(error, url)}`);
  } finally {
    await pool.end();
  }
}
