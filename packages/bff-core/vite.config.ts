import { fileURLToPath } from 'node:url';

import { defineLibraryConfig, isExternal } from '@repo/vite-config';

const src = fileURLToPath(new URL('./src/', import.meta.url));

export default defineLibraryConfig({
  platform: 'node',
  entry: {
    index: `${src}index.ts`,
    'migrations/index': `${src}migrations/index.ts`,
    'nestjs/index': `${src}nestjs/index.ts`,
    // The core-api stub, and the AppModule test harness on Nest, for the BFFs' own tests.
    'testing/index': `${src}testing/index.ts`,
    'testing/nestjs/index': `${src}testing/nestjs/index.ts`,
  },
  overrides: {
    // Nest decorators are legacy (experimentalDecorators) decorators. Their parameter-type metadata lets
    // @nestjs/swagger document `@Query({ schema })` parameters (e.g. /api/auth/login's returnTo).
    oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
    // Oxc's decorator helpers (`@oxc-project/runtime`) are bundled, so consumers don't need that package.
    build: { rolldownOptions: { external: (id: string) => isExternal(id) && !id.startsWith('@oxc-project/runtime/') } },
  },
});
