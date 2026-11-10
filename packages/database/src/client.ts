import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema/index.js';

export type DatabaseSchema = typeof schema;

export type Database = NodePgDatabase<DatabaseSchema> & { $client: Pool };

/**
 * Creates the process's single connection pool and wraps it in Drizzle.
 * Call once per process; the owner closes it with `db.$client.end()`.
 */
export function createDatabase(config: string | PoolConfig): Database {
  const pool = new Pool(typeof config === 'string' ? { connectionString: config } : config);
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}
