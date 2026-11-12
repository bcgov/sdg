import * as path from 'node:path';

import { devices, type Project } from '@playwright/test';
import { definePlaywrightConfig } from '@repo/playwright-config';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(import.meta.dirname, '.env'), quiet: true });

// CI points E2E_BASE_URL at a deployed PR environment's console host; locally Playwright serves the built app.
const deployedURL = process.env['E2E_BASE_URL'];
const baseURL = deployedURL ?? 'http://localhost:4174';
// An IDIR test account holding the admin client role. Without both, the signed-in specs are skipped.
const consoleUsername = process.env['E2E_CONSOLE_USERNAME'] ?? '';
const consolePassword = process.env['E2E_CONSOLE_PASSWORD'] ?? '';
const signedIn = consoleUsername !== '' && consolePassword !== '';
/** The setup project's signed-in browser state (gitignored: playwright/.auth/). */
const consoleAuthFile = path.resolve(import.meta.dirname, 'playwright/.auth/console.json');
const SIGNED_IN_SPECS = 'service-clients.spec.ts';

const config = definePlaywrightConfig(deployedURL ? { baseURL } : { baseURL, webServer: { command: 'pnpm preview' } });

const consoleSetup: Project = {
  name: 'console-setup',
  testDir: './e2e/setup',
  testMatch: 'console.setup.ts',
  use: { clientURL: baseURL, clientUsername: consoleUsername, clientPassword: consolePassword },
};

const signedInSpecs: Project = {
  name: 'signed-in',
  testMatch: SIGNED_IN_SPECS,
  use: { ...devices['Desktop Chrome'], ...(signedIn ? { storageState: consoleAuthFile } : {}) },
  dependencies: signedIn ? ['console-setup'] : [],
};

// Signed-out specs run on chromium and webkit (Playwright 1.64's Firefox fails on current macOS, as for portal-web);
// the signed-in specs run once, on chromium, after the setup project signs in.
export default {
  ...config,
  projects: [
    ...(config.projects ?? [])
      .filter((project) => project.name === 'chromium' || project.name === 'webkit')
      .map((project) => Object.assign(project, { testIgnore: SIGNED_IN_SPECS })),
    ...(signedIn ? [consoleSetup] : []),
    signedInSpecs,
  ],
};
