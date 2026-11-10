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
   * (`<schema>.__drizzle_migrations`), so it never collides with another login's journal (KTD9).
   */
  readonly migrationsSchema: string;
}

function parseDatabaseUrl(raw: string | undefined): URL {
  if (!raw) throw new SessionMigrationError('DATABASE_URL is not set.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SessionMigrationError('DATABASE_URL is not a valid URL.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new SessionMigrationError('DATABASE_URL must use postgres:// or postgresql://.');
  }
  return url;
}

/** The messages along the `cause` chain (drizzle wraps the pg error), with the URL and password masked. */
function redact(error: unknown, url: URL): string {
  const messages: string[] = [];
  for (let current: unknown = error; current instanceof Error; current = current.cause) messages.push(current.message);
  const message = messages.length > 0 ? messages.join(': ') : 'unknown error';
  const secrets = [url.href, url.password, decodeURIComponent(url.password)].filter(Boolean);
  return secrets.reduce((text, secret) => text.replaceAll(secret, '***'), message);
}

/**
 * Applies the sessions migrations as the BFF's own login: the `sessions` table lands in that login's schema and the
 * login schedules its own `<login>-prune-expired-sessions` job (KTD9). Run from each BFF image's session-migrate
 * entry (an initContainer). Resolves when nothing is pending; rejects with a {@link SessionMigrationError} otherwise.
 */
export async function runSessionMigrations(
  databaseUrl: string | undefined,
  options: SessionMigrationOptions,
): Promise<void> {
  const url = parseDatabaseUrl(databaseUrl);
  const target = `${url.host}${url.pathname}`;
  const pool = new Pool({ connectionString: url.href, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: sessionMigrationsFolder,
      migrationsSchema: options.migrationsSchema,
    });
  } catch (error) {
    // The original error is not attached as `cause`: pg errors can carry the connection string.
    throw new SessionMigrationError(`Migrating sessions on ${target} failed: ${redact(error, url)}`);
  } finally {
    await pool.end();
  }
}
