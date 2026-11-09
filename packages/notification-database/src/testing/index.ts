import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { migrationsFolder } from '../migrations-folder.js';

/**
 * Applies the committed migrations to an in-process Postgres (PGlite) wrapped in Drizzle, for tests:
 * `await migrateTestDatabase(drizzle({ client: new PGlite(), schema, casing: 'snake_case' }))`.
 */
export async function migrateTestDatabase<TSchema extends Record<string, unknown>>(
  db: PgliteDatabase<TSchema>,
): Promise<void> {
  await migrate(db, { migrationsFolder });
}
