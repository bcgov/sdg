import { fileURLToPath } from 'node:url';

import { defineLibraryConfig, isExternal } from '@repo/vite-config';

const src = fileURLToPath(new URL('./src/', import.meta.url));

export default defineLibraryConfig({
  platform: 'node',
  entry: {
    index: `${src}index.ts`,
    'forwarding/index': `${src}forwarding/index.ts`,
    'nestjs/index': `${src}nestjs/index.ts`,
    // Preloaded with `node --import` before the instrumented libraries load; the SDK itself is a lazy chunk.
    'telemetry/index': `${src}telemetry/index.ts`,
  },
  overrides: {
    oxc: { decorator: { legacy: true } },
    // Oxc's decorator helpers (`@oxc-project/runtime`) are bundled, so consumers don't need that package.
    build: { rolldownOptions: { external: (id: string) => isExternal(id) && !id.startsWith('@oxc-project/runtime/') } },
  },
});
