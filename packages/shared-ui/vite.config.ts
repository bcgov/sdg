import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineLibraryConfig } from '@repo/vite-config';
import { defineConfig, type Plugin } from 'vite';

import { cdnBuildConfig, oxc } from './scripts/vite-builds.ts';

const source = (path: string): string => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

/** Copies the pre-load CSS rule to dist/header/preload.css for the package's `./header/preload.css` export. */
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
// `vite build --mode cdn` → dist/cdn/header/v<HEADER_MAJOR>/bundles/sdg-header-<hash>.js, one classic IIFE script with
// Preact and everything else bundled and no chunks, so a rollout can never pair a new entry with old chunks; plus
// dist/release.json (path, integrity, sequence) for the signer, outside the served tree. The loaders are built only by
// `pnpm build:loaders` (scripts/build-loaders.ts), never here: their bytes are committed and locked.
export default defineConfig(({ mode }) =>
  mode === 'cdn'
    ? cdnBuildConfig()
    : defineLibraryConfig({
        platform: 'browser',
        entry: { 'header/index': source('header/index.ts'), 'header/react/index': source('header/react/index.ts') },
        overrides: { oxc, plugins: [preloadCss()] },
      }),
);
