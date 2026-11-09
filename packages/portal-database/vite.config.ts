import { fileURLToPath } from 'node:url';

import { defineLibraryConfig } from '@repo/vite-config';

const src = fileURLToPath(new URL('./src/', import.meta.url));

export default defineLibraryConfig({
  platform: 'node',
  entry: {
    index: `${src}index.ts`,
    'schema/index': `${src}schema/index.ts`,
    // Test helpers for consumers that migrate PGlite (pg_cron stub).
    'testing/index': `${src}testing/index.ts`,
    // The portal-database image's initContainer command: node dist/migrate.js
    migrate: `${src}migrate.ts`,
  },
});
