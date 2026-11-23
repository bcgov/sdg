import { defineConfig, devices, test as base, type PlaywrightTestConfig } from '@playwright/test';

import { connectionLogFixture } from './connection-log.ts';
import { retryGateFixture } from './retry-gate.ts';

// Define the type for your custom configuration variable
export type E2ETestOptions = {
  clientURL: string;
  clientUsername: string;
  clientPassword: string;
};

// Extend the base test object to include your new option
export const test = base.extend<E2ETestOptions & { connectionLog: void; retryGate: void }>({
  clientURL: ['', { option: true }],
  clientUsername: ['', { option: true }],
  clientPassword: ['', { option: true }],
  // With E2E_CONNECTION_LOG set (CI sets it), every test logs its new connections and failed requests to that file.
  connectionLog: [connectionLogFixture, { auto: true }],
  // A retry first waits (on its own timeout, outside the test's) until the base URL answers again.
  retryGate: [retryGateFixture, { auto: true, timeout: 180_000 }],
});

export interface PlaywrightOptions {
  /** URL the app is served from; also used to wait for `webServer`. */
  baseURL: string;
  /** Command that starts the app under test, if Playwright should manage it. */
  webServer?: { command: string; cwd?: string; timeout?: number };
  /** Optional username for the client account to be used in tests. */
  clientUsername?: string;
  /** Optional password for the client account to be used in tests. */
  clientPassword?: string;
  overrides?: PlaywrightTestConfig;
}

/** Playwright config for an app-level e2e suite in `./e2e`. */
export function definePlaywrightConfig({
  baseURL,
  webServer,
  clientUsername,
  clientPassword,
  overrides = {},
}: PlaywrightOptions): PlaywrightTestConfig {
  const ci = Boolean(process.env['CI']);

  return defineConfig<E2ETestOptions>({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: ci,
    retries: ci ? 2 : 0,
    ...(ci ? { workers: 1 } : {}),
    reporter: ci ? [['html', { open: 'never' }], ['github']] : [['html', { open: 'on-failure' }]],
    use: {
      baseURL,
      trace: 'on-first-retry',
      // One browser context per worker, reset between tests, so connections stay open from test to test: a fresh
      // context per test opens new TCP connections each time, and the Gold cluster drops a runner that opens too many.
      reuseContext: true,
    },
    projects: [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'webkit', use: { ...devices['Desktop Safari'] } },
      {
        name: 'client-setup',
        testMatch: 'client.setup.ts',
        testDir: './e2e/setup',
        use: {
          clientURL: baseURL,
          clientUsername: clientUsername,
          clientPassword: clientPassword,
        },
      },
    ],
    ...(webServer ? { webServer: { ...webServer, url: baseURL, reuseExistingServer: !ci } } : {}),
    ...overrides,
  });
}
