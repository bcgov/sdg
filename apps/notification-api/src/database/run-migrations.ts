// Imports packages only (no relative imports), so scripts/migrate.ts can run this file through Node's type stripping.
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, escapeIdentifier } from 'pg';

/** The committed drizzle-kit migrations. src/database and dist/database both sit two levels below drizzle/. */
export const migrationsFolder: string = fileURLToPath(new URL('../../drizzle', import.meta.url));

const CONNECTION_TIMEOUT_MS = 10_000;

/** A failed migration run. The message names the target host and database, never the credentials. */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export interface MigrationResult {
  /** `host:port/database` of the migrated database. */
  target: string;
  /** The database did not exist and this run created it. */
  databaseCreated: boolean;
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
  if (url.pathname.length <= 1) throw new MigrationError('DATABASE_URL must name a database, e.g. …/notification.');
  return url;
}

/** The messages along the `cause` chain (drizzle wraps the pg error), with the URLs and password masked. */
function redact(error: unknown, url: URL): string {
  const messages: string[] = [];
  for (let current: unknown = error; current instanceof Error; current = current.cause) messages.push(current.message);
  const message = messages.length > 0 ? messages.join(': ') : 'unknown error';
  const secrets = [url.href, url.password, decodeURIComponent(url.password)].filter(Boolean);
  return secrets.reduce((text, secret) => text.replaceAll(secret, '***'), message);
}

/** The same server and credentials, on its `postgres` maintenance database. */
function maintenanceUrl(url: URL): string {
  const admin = new URL(url.href);
  admin.pathname = '/postgres';
  return admin.href;
}

/** Creates the named database when the server has none by that name. Resolves true when it created it. */
async function ensureDatabase(url: URL, name: string): Promise<boolean> {
  const client = new Client({ connectionString: maintenanceUrl(url), connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
  try {
    await client.connect();
    const existing = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (existing.rowCount !== 0) return false;
    await client.query(`create database ${escapeIdentifier(name)}`);
    return true;
  } finally {
    await client.end();
  }
}

async function applyMigrations(url: URL): Promise<void> {
  const client = new Client({ connectionString: url.href, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
  try {
    await client.connect();
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.end();
  }
}

/**
 * Creates the database DATABASE_URL names when it is missing (through the server's `postgres` database), then
 * applies the committed drizzle-kit migrations. drizzle records each one in `drizzle.__drizzle_migrations`, which
 * `drizzle-kit migrate` shares, so re-running applies only what is pending.
 * Rejects with a {@link MigrationError} whose message carries no credentials.
 */
export async function runMigrations(databaseUrl: string | undefined): Promise<MigrationResult> {
  const url = parseDatabaseUrl(databaseUrl);
  const target = `${url.host}${url.pathname}`;
  try {
    const databaseCreated = await ensureDatabase(url, decodeURIComponent(url.pathname.slice(1)));
    await applyMigrations(url);
    return { target, databaseCreated };
  } catch (error) {
    // The original error is not attached as `cause`: pg errors can carry the connection string.
    throw new MigrationError(`Migrating ${target} failed: ${redact(error, url)}`);
  }
}
