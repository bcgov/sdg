import { fileURLToPath } from 'node:url';

import { defineLibraryConfig } from '@repo/vite-config';
import { defineConfig } from 'vite';

const entry = fileURLToPath(new URL('./src/index.ts', import.meta.url));
// The React wrapper is its own entry: it imports the core entry, which never imports React.
const reactEntry = fileURLToPath(new URL('./src/react/index.ts', import.meta.url));

// `vite build` → dist/index.js and dist/react/index.js for registries: lit, Font Awesome and react stay external, the
// consumer's bundler dedupes them.
// `vite build --mode cdn` → dist/cdn/sdg-header.js: one minified module with everything bundled, for
// <script type="module"> straight from a CDN.
export default defineConfig(({ mode }) =>
  mode === 'cdn'
    ? defineLibraryConfig({
        platform: 'browser',
        entry: { 'sdg-header': entry },
        // Library mode keeps whitespace in ES output; a CDN file wants it fully minified.
        overrides: {
          build: {
            outDir: 'dist/cdn',
            minify: true,
            rolldownOptions: { external: () => false, output: { minify: true } },
          },
        },
      })
    : defineLibraryConfig({ platform: 'browser', entry: { index: entry, 'react/index': reactEntry } }),
);
