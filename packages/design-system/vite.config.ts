import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineLibraryConfig } from '@repo/vite-config';

const src = fileURLToPath(new URL('./src/', import.meta.url));

// One entry per src/components/<name>/index.ts → @repo/design-system/components/<name>.
const components = readdirSync(`${src}components`, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

export default defineLibraryConfig({
  platform: 'react',
  entry: {
    ...Object.fromEntries(components.map((name) => [`components/${name}/index`, `${src}components/${name}/index.ts`])),
    'icons/index': `${src}icons/index.ts`,
  },
  // Custom components' CSS Modules are extracted into one stylesheet, exported as @repo/design-system/styles.css.
  overrides: { build: { lib: { cssFileName: 'styles' } } },
});
