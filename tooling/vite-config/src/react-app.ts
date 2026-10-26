import react from '@vitejs/plugin-react';
import { mergeConfig, type UserConfig } from 'vite';

/** Vite config for a React application. */
export function defineReactAppConfig(overrides: UserConfig = {}): UserConfig {
  return mergeConfig<UserConfig, UserConfig>(
    {
      plugins: [react()],
      build: { sourcemap: true },
    },
    overrides,
  );
}
