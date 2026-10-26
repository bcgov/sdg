import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createPortalDatabase } from './client.js';
import { migrationsFolder } from './migrations-folder.js';

/** A failed migration run. The message names the target host and database, never the credentials. */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

function parseDatabaseUrl(raw: string | undefined): URL {
  if (!raw) throw new MigrationError('DATABASE_URL is not set.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MigrationError('DATABASE_URL is not a valid URL.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new MigrationError('DATABASE_URL must use postgres:// or postgresql://.');
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
 * Applies the committed drizzle-kit migrations with drizzle-orm's node-postgres migrator. It shares
 * `drizzle.__drizzle_migrations` with `drizzle-kit migrate`, so either runner sees the other's work.
 * Resolves when nothing is pending; rejects with a {@link MigrationError} otherwise.
 */
export async function runMigrations(databaseUrl: string | undefined): Promise<void> {
  const url = parseDatabaseUrl(databaseUrl);
  const target = `${url.host}${url.pathname}`;
  const db = createPortalDatabase({ connectionString: url.href, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    await migrate(db, { migrationsFolder });
  } catch (error) {
    // The original error is not attached as `cause`: pg errors can carry the connection string.
    throw new MigrationError(`Migrating ${target} failed: ${redact(error, url)}`);
  } finally {
    await db.$client.end();
  }
}
