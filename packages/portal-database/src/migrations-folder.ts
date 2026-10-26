import { fileURLToPath } from 'node:url';

/**
 * Absolute path of the committed drizzle-kit migrations. Both src/ and dist/ sit next to migrations/,
 * so this resolves the same from source and from the build.
 */
export const migrationsFolder: string = fileURLToPath(new URL('../migrations', import.meta.url));
