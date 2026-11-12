import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema/index.js';

export type DatabaseSchema = typeof schema;

export type Database = NodePgDatabase<DatabaseSchema> & { $client: Pool };

export interface DatabaseOptions {
  /**
   * Called when Postgres drops an idle pooled client (a restart, a Patroni switchover). The pool has already discarded
   * the client, so logging is enough; without this listener pg's 'error' event would crash the process.
   */
  readonly onIdleClientError: (error: Error) => void;
}

/**
 * Creates the process's single connection pool and wraps it in Drizzle.
 * Call once per process; the owner closes it with `db.$client.end()`.
 */
export function createDatabase(config: string | PoolConfig, options: DatabaseOptions): Database {
  const pool = new Pool(typeof config === 'string' ? { connectionString: config } : config);
  pool.on('error', (error) => options.onIdleClientError(error));
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}
