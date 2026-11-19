import * as path from 'node:path';

import type { PlaywrightTestConfig } from '@playwright/test';
import { definePlaywrightConfig } from '@repo/playwright-config';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(import.meta.dirname, '.env') });

// CI points E2E_BASE_URL at a deployed PR environment; locally Playwright starts the Vite dev server and the header's
// dev server (@repo/shared-ui), which Vite proxies at /shared-ui like the edge does.
const deployedURL = process.env['E2E_BASE_URL'];
const clientUsername = process.env['PLAYWRIGHT_CLIENT_USERNAME'];
const clientPassword = process.env['PLAYWRIGHT_CLIENT_PASSWORD'];

function localConfig(): PlaywrightTestConfig {
  const local = definePlaywrightConfig({
    baseURL: 'http://localhost:5173',
    webServer: { command: 'pnpm dev' },
    clientUsername,
    clientPassword,
  });
  const headerServer = {
    command: 'pnpm --filter @repo/shared-ui dev',
    url: 'http://localhost:5180/header/v1/sdg-header.js',
    reuseExistingServer: !process.env['CI'],
  };
  return { ...local, webServer: [...[local.webServer ?? []].flat(), headerServer] };
}

const config = deployedURL
  ? definePlaywrightConfig({
      baseURL: deployedURL,
      clientUsername,
      clientPassword,
    })
  : localConfig();

// Playwright 1.64's Firefox build (firefox-1555) exits with "Could not find profile folder" on current macOS,
// so portal-web runs chromium + webkit only. Remove this filter once a Playwright release fixes Firefox.
export default {
  ...config,
  projects: config.projects?.filter((project) => project.name !== 'firefox'),
};
