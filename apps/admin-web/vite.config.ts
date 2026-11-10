import { defineReactAppConfig } from '@repo/vite-config';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { mergeConfig } from 'vite';

// admin-api serves the BFF under /api. Proxying keeps it same-origin, so its session cookie stays first-party and its
// origin guard sees admin-web's own origin.
const apiProxy = {
  '/api': { target: process.env['ADMIN_API_URL'] ?? 'http://localhost:3000', xfwd: true },
};

// The router plugin must run before react(), and defineReactAppConfig appends override plugins after it,
// so merge the router plugin in front of the factory output. Ports sit beside portal-web's (5173, 4173).
export default mergeConfig(
  { plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true })] },
  defineReactAppConfig({
    server: { port: 5174, strictPort: true, proxy: apiProxy },
    preview: { port: 4174, strictPort: true, proxy: apiProxy },
  }),
);
