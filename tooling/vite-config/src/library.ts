import { isAbsolute } from 'node:path';

import react from '@vitejs/plugin-react';
import { mergeConfig, type LibraryOptions as ViteLibraryOptions, type UserConfig } from 'vite';

export interface LibraryOptions {
  entry: ViteLibraryOptions['entry'];
  /** `browser`: DOM code with no framework plugin (e.g. Lit custom elements). */
  platform: 'node' | 'react' | 'browser';
  overrides?: UserConfig;
}

/** Bare specifiers (dependencies, peers, `node:` builtins) stay external; only local sources are bundled. */
export function isExternal(id: string): boolean {
  return !id.startsWith('.') && !id.startsWith('\0') && !isAbsolute(id);
}

/**
 * Vite library-mode config emitting ESM only. Type declarations are emitted separately
 * with `tsc -p tsconfig.build.json` after `vite build` (TypeScript 7 has no compiler API for dts plugins).
 */
export function defineLibraryConfig({ entry, platform, overrides = {} }: LibraryOptions): UserConfig {
  return mergeConfig<UserConfig, UserConfig>(
    {
      plugins: platform === 'react' ? [react()] : [],
      build: {
        target: platform === 'node' ? 'node24' : 'es2024',
        sourcemap: true,
        minify: false,
        lib: {
          entry,
          formats: ['es'],
          fileName: (_format, entryName) => `${entryName}.js`,
        },
        rolldownOptions: { external: isExternal },
      },
    },
    overrides,
  );
}
