import { defineReactAppConfig } from '@repo/vite-config';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { mergeConfig } from 'vite';

// portal-api serves the BFF under /api. Proxying keeps it same-origin, so its session cookie stays first-party.
// /shared-ui goes to @repo/shared-ui's dev server (its `pnpm dev`), prefix stripped like the edge's handle_path, so the
// header script loads from the same path as in every deployed environment.
const apiProxy = {
  '/api': { target: process.env['PORTAL_API_URL'] ?? 'http://localhost:3000', xfwd: true },
  '/shared-ui/': {
    target: process.env['SHARED_UI_URL'] ?? 'http://localhost:5180',
    rewrite: (path: string) => path.replace(/^\/shared-ui/, ''),
  },
};

// The router plugin must run before react(), and defineReactAppConfig appends override plugins after it,
// so merge the router plugin in front of the factory output.
export default mergeConfig(
  { plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true })] },
  defineReactAppConfig({ server: { proxy: apiProxy }, preview: { port: 4173, strictPort: true, proxy: apiProxy } }),
);
