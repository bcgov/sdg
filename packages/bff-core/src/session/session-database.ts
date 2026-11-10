import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { Pool } from 'pg';

import { sessions, type SessionsTable } from './sessions.schema.js';

export type SessionSchema = {
  sessions: SessionsTable;
};

const schema: SessionSchema = { sessions };

/** The session store's database: node-postgres in production, PGlite in tests (both share Drizzle's pg query API). */
export type SessionDatabase = PgDatabase<PgQueryResultHKT, SessionSchema>;

/** Wraps the BFF's single pool (its own login, KTD8) in Drizzle. The pool's owner ends it. */
export function createSessionDatabase(pool: Pool): SessionDatabase {
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}
