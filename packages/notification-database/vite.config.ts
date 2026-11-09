import { fileURLToPath } from 'node:url';

import { defineLibraryConfig } from '@repo/vite-config';

const src = fileURLToPath(new URL('./src/', import.meta.url));

export default defineLibraryConfig({
  platform: 'node',
  entry: {
    index: `${src}index.ts`,
    'schema/index': `${src}schema/index.ts`,
    // Test helpers: apply the migrations to PGlite.
    'testing/index': `${src}testing/index.ts`,
    // The notification-database image's initContainer command (on notification-api): node dist/migrate.js
    migrate: `${src}migrate.ts`,
  },
});
