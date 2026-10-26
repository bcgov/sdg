import { definePlaywrightConfig } from '@repo/playwright-config';

// CI points E2E_BASE_URL at a deployed PR environment; locally Playwright serves the built app.
const deployedURL = process.env['E2E_BASE_URL'];

const config = deployedURL
  ? definePlaywrightConfig({ baseURL: deployedURL })
  : definePlaywrightConfig({ baseURL: 'http://localhost:4173', webServer: { command: 'pnpm preview' } });

// Playwright 1.64's Firefox build (firefox-1555) exits with "Could not find profile folder" on current macOS,
// so portal-web runs chromium + webkit only. Remove this filter once a Playwright release fixes Firefox.
export default { ...config, projects: config.projects?.filter((project) => project.name !== 'firefox') };
