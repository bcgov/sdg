import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

export interface PlaywrightOptions {
  /** URL the app is served from; also used to wait for `webServer`. */
  baseURL: string;
  /** Command that starts the app under test, if Playwright should manage it. */
  webServer?: { command: string; cwd?: string; timeout?: number };
  overrides?: PlaywrightTestConfig;
}

/** Playwright config for an app-level e2e suite in `./e2e`. */
export function definePlaywrightConfig({
  baseURL,
  webServer,
  overrides = {},
}: PlaywrightOptions): PlaywrightTestConfig {
  const ci = Boolean(process.env['CI']);

  return defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: ci,
    retries: ci ? 2 : 0,
    ...(ci ? { workers: 1 } : {}),
    reporter: ci ? [['html', { open: 'never' }], ['github']] : [['html', { open: 'on-failure' }]],
    use: {
      baseURL,
      trace: 'on-first-retry',
    },
    projects: [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
    ...(webServer ? { webServer: { ...webServer, url: baseURL, reuseExistingServer: !ci } } : {}),
    ...overrides,
  });
}
