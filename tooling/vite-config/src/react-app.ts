import react from '@vitejs/plugin-react';
import { mergeConfig, type UserConfig } from 'vite';

import { adoptedStyleSheets } from './adopted-style-sheets.ts';

/** Vite config for a React application. */
export function defineReactAppConfig(overrides: UserConfig = {}): UserConfig {
  return mergeConfig<UserConfig, UserConfig>(
    {
      // adoptedStyleSheets: the bcgov design system's CSS loads under the edge's strict style-src.
      plugins: [react(), adoptedStyleSheets()],
      build: { sourcemap: true },
    },
    overrides,
  );
}
