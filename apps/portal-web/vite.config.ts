import { defineReactAppConfig } from '@repo/vite-config';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { mergeConfig } from 'vite';

// portal-api serves the BFF under /api. Proxying keeps it same-origin, so its session cookie stays first-party.
const apiProxy = {
  '/api': { target: process.env['PORTAL_API_URL'] ?? 'http://localhost:3000', xfwd: true },
};

// The router plugin must run before react(), and defineReactAppConfig appends override plugins after it,
// so merge the router plugin in front of the factory output.
export default mergeConfig(
  { plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true })] },
  defineReactAppConfig({ server: { proxy: apiProxy }, preview: { port: 4173, strictPort: true, proxy: apiProxy } }),
);
