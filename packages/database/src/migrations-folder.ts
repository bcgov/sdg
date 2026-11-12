import { fileURLToPath } from 'node:url';

/**
 * Absolute path of the committed drizzle-kit migrations. Both src/ and dist/ sit next to migrations/,
 * so this resolves the same from source and from the build.
 */
export const migrationsFolder: string = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Where every migrator of these migrations keeps its journal (`<schema>.__drizzle_migrations`): the `core` login's
 * own schema, so it never collides with another login's journal. drizzle.config.ts uses the same value.
 */
export const migrationsSchema = 'core';
