import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, escapeIdentifier } from 'pg';

import { migrationsFolder } from './migrations-folder.js';

const CONNECTION_TIMEOUT_MS = 10_000;

/**
 * The session-level advisory lock that lets one migrator at a time work on a database: drizzle has no lock of its own
 * and reads the last applied migration outside its transaction, so init containers starting together would race.
 * Advisory locks are per database, so any fixed bigint works.
 */
export const MIGRATION_LOCK_KEY = 7_105_116_105_111_110;

/** How long a migrator waits for another one to finish before it gives up. */
const DEFAULT_LOCK_WAIT_MS = 120_000;

/** SQLSTATE lock_not_available: `lock_timeout` expired. */
const LOCK_NOT_AVAILABLE = '55P03';

export interface MigrationOptions {
  /** Milliseconds to wait for {@link MIGRATION_LOCK_KEY} (default 120 000). */
  lockWaitMs?: number;
}

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

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** Takes {@link MIGRATION_LOCK_KEY} for the client's session, waiting at most `waitMs`. */
async function acquireMigrationLock(client: Client, waitMs: number): Promise<void> {
  await client.query(`select set_config('lock_timeout', $1, false)`, [`${waitMs}ms`]);
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  } catch (error) {
    if (!hasCode(error, LOCK_NOT_AVAILABLE)) throw error;
    throw new MigrationError(
      `timed out after ${waitMs / 1000}s waiting for the migration lock (pg_advisory_lock ${MIGRATION_LOCK_KEY}); ` +
        'another migrator still holds it.',
    );
  }
  // The migrations themselves wait for their locks as long as they need to.
  await client.query('reset lock_timeout');
}

/** Applies the migrations on one client that holds the migration lock; ending the session releases the lock. */
async function applyMigrations(url: URL, lockWaitMs: number): Promise<void> {
  const client = new Client({ connectionString: url.href, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
  try {
    await client.connect();
    await acquireMigrationLock(client, lockWaitMs);
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.end();
  }
}

/**
 * Creates the database DATABASE_URL names when it is missing (through the server's `postgres` database), then
 * applies the committed drizzle-kit migrations while holding {@link MIGRATION_LOCK_KEY}, so concurrent runners apply
 * each migration once. drizzle records each one in `drizzle.__drizzle_migrations`, so re-running applies only what is
 * pending.
 * Rejects with a {@link MigrationError} whose message carries no credentials.
 */
export async function runMigrations(
  databaseUrl: string | undefined,
  { lockWaitMs = DEFAULT_LOCK_WAIT_MS }: MigrationOptions = {},
): Promise<MigrationResult> {
  const url = parseDatabaseUrl(databaseUrl);
  const target = `${url.host}${url.pathname}`;
  try {
    const databaseCreated = await ensureDatabase(url, decodeURIComponent(url.pathname.slice(1)));
    await applyMigrations(url, lockWaitMs);
    return { target, databaseCreated };
  } catch (error) {
    // The original error is not attached as `cause`: pg errors can carry the connection string.
    throw new MigrationError(`Migrating ${target} failed: ${redact(error, url)}`);
  }
}
