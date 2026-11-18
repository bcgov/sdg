import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineLibraryConfig } from '@repo/vite-config';
import { defineConfig, type Plugin, type UserConfig } from 'vite';

import { headerCdnPath } from './src/header/contract.ts';

const source = (path: string): string => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

// The element is Preact; React files under src/header/react override this with a @jsxImportSource pragma.
const oxc: UserConfig['oxc'] = { jsx: { runtime: 'automatic', importSource: 'preact' } };

/** Copies the pre-load CSS rule (R20) to dist/header/preload.css for the package's `./header/preload.css` export. */
function preloadCss(): Plugin {
  return {
    name: 'shared-ui:preload-css',
    generateBundle() {
      const css = readFileSync(source('header/preload.css'), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'header/preload.css', source: css });
    },
  };
}

// `vite build` → dist/header/index.js and dist/header/react/index.js for in-repo apps: preact and react stay external.
// `vite build --mode cdn` → dist/cdn/header/v<HEADER_MAJOR>/sdg-header.js: one classic IIFE script with Preact and
// everything else bundled and no chunks (KTD1), so it loads cross-origin without CORS and a rollout can never pair a
// new entry with old chunks.
export default defineConfig(({ mode }) =>
  mode === 'cdn'
    ? defineLibraryConfig({
        platform: 'browser',
        entry: {},
        overrides: {
          oxc,
          build: {
            // Not library mode: lib.formats would merge with the default ['es'] instead of replacing it.
            lib: false,
            outDir: `dist/cdn/${dirname(headerCdnPath())}`,
            copyPublicDir: false,
            sourcemap: false,
            minify: true,
            rolldownOptions: {
              input: source('header/element/cdn.ts'),
              external: () => false,
              output: { format: 'iife', entryFileNames: 'sdg-header.js', codeSplitting: false },
            },
          },
        },
      })
    : defineLibraryConfig({
        platform: 'browser',
        entry: { 'header/index': source('header/index.ts'), 'header/react/index': source('header/react/index.ts') },
        overrides: { oxc, plugins: [preloadCss()] },
      }),
);
