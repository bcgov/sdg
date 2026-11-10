import { fileURLToPath } from 'node:url';

import { defineLibraryConfig, isExternal } from '@repo/vite-config';

const src = fileURLToPath(new URL('./src/', import.meta.url));

export default defineLibraryConfig({
  platform: 'node',
  entry: {
    index: `${src}index.ts`,
    // runSessionMigrations and the migrations folder, for each BFF's session-migrate entry.
    'migrations/index': `${src}migrations/index.ts`,
    'nestjs/index': `${src}nestjs/index.ts`,
  },
  overrides: {
    // Nest decorators are legacy (experimentalDecorators) decorators.
    oxc: { decorator: { legacy: true } },
    // Oxc's decorator helpers (`@oxc-project/runtime`) are bundled, so consumers don't need that package.
    build: { rolldownOptions: { external: (id: string) => isExternal(id) && !id.startsWith('@oxc-project/runtime/') } },
  },
});
