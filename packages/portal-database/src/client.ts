import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema/index.js';

export type PortalSchema = typeof schema;

export type PortalDatabase = NodePgDatabase<PortalSchema> & { $client: Pool };

/**
 * Creates the portal's single connection pool and wraps it in Drizzle.
 * Call once per process; the owner closes it with `db.$client.end()`.
 */
export function createPortalDatabase(config: string | PoolConfig): PortalDatabase {
  const pool = new Pool(typeof config === 'string' ? { connectionString: config } : config);
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}
