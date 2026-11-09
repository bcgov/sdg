import * as path from 'node:path';

import { definePlaywrightConfig } from '@repo/playwright-config';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(import.meta.dirname, '.env') });

// CI points E2E_BASE_URL at a deployed PR environment; locally Playwright serves the built app.
const deployedURL = process.env['E2E_BASE_URL'];
const clientUsername = process.env['E2E_CLIENT_USERNAME'];
const clientPassword = process.env['E2E_CLIENT_PASSWORD'];

const config = deployedURL
  ? definePlaywrightConfig({
      baseURL: deployedURL,
      clientUsername,
      clientPassword,
    })
  : definePlaywrightConfig({
      baseURL: 'http://localhost:5173',
      webServer: { command: 'pnpm test:e2e' },
      clientUsername,
      clientPassword,
    });

// Playwright 1.64's Firefox build (firefox-1555) exits with "Could not find profile folder" on current macOS,
// so portal-web runs chromium + webkit only. Remove this filter once a Playwright release fixes Firefox.
export default {
  ...config,
  projects: config.projects?.filter((project) => project.name !== 'firefox'),
};
