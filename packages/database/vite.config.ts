import { fileURLToPath } from 'node:url';

import { defineLibraryConfig } from '@repo/vite-config';

const src = fileURLToPath(new URL('./src/', import.meta.url));

export default defineLibraryConfig({
  platform: 'node',
  entry: {
    index: `${src}index.ts`,
    'schema/index': `${src}schema/index.ts`,
    'testing/index': `${src}testing/index.ts`,
    migrate: `${src}migrate.ts`,
  },
});
