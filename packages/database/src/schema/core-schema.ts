import { pgSchema, type PgSchema } from 'drizzle-orm/pg-core';

/**
 * The `core` Postgres schema, owned by the `core` login (charts/postgres init SQL; dev-postgres/init-roles.sql).
 * Not exported from the schema entry, so drizzle-kit never emits `CREATE SCHEMA`: the init SQL creates it, and the
 * migrator creates it too when it is missing, because it keeps its journal there (`migrationsSchema`).
 */
export const coreSchema: PgSchema<'core'> = pgSchema('core');
