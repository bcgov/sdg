import { fileURLToPath } from 'node:url';

/**
 * Absolute path of the committed sessions migrations (the package's migrations/). This module is only ever bundled
 * into dist/migrations/index.js, and both it and src/migrations/ sit two levels below the package root, so the path
 * resolves the same from source and from the build.
 */
export const sessionMigrationsFolder: string = fileURLToPath(new URL('../../migrations', import.meta.url));
