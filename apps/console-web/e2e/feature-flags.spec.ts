import { expect, type Page, test } from '@playwright/test';

import { mockSession } from './support/mock-console-api';

const FLAGS = '**/api/v1/shared/flags';
const HELLO_WORLD = '**/api/v1/shared/hello-world';

/** Fakes the evaluated flags console-api forwards from core-api. */
async function mockFlags(page: Page, flags: Record<string, true>): Promise<void> {
  await page.route(FLAGS, (route) => route.fulfill({ json: flags }));
}

/** The dashboard rendered in the shell, without hello-world or any error notice, and still on `/`. */
async function expectPlainDashboard(page: Page) {
  await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveText('Dashboard');
  await expect(page.getByRole('main')).toContainText('There is nothing on the dashboard yet.');
  await expect(page.getByText('Hello, world!')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
}

// The flag provider and the dashboard's hello-world demo, with console-api answered in the browser.
test.describe('console-web feature flags', () => {
  test('shows "Hello, world!" on the dashboard when hello_world is on for the console user (AE9)', async ({ page }) => {
    await mockSession(page, () => true);
    await mockFlags(page, { hello_world: true });
    await page.route(HELLO_WORLD, (route) => route.fulfill({ json: { message: 'Hello, world!' } }));
    await page.goto('/');
    await expect(page.getByRole('main').getByText('Hello, world!')).toBeVisible();
  });

  test('leaves hello-world out, and never calls it, when the flag is off', async ({ page }) => {
    await mockSession(page, () => true);
    await mockFlags(page, {});
    let helloWorldCalls = 0;
    await page.route(HELLO_WORLD, (route) => {
      helloWorldCalls += 1;
      return route.fulfill({ status: 404, json: { statusCode: 404, message: 'Not Found' } });
    });
    const flagsResponse = page.waitForResponse(FLAGS);
    await page.goto('/');
    await flagsResponse;
    await expectPlainDashboard(page);
    expect(helloWorldCalls).toBe(0);
  });

  test('renders the dashboard without hello-world when the flags request fails (R7)', async ({ page }) => {
    await mockSession(page, () => true);
    await page.route(FLAGS, (route) => route.fulfill({ status: 503, json: { statusCode: 503 } }));
    const flagsResponse = page.waitForResponse(FLAGS);
    await page.goto('/');
    await flagsResponse;
    await expectPlainDashboard(page);
  });

  test('stays on the dashboard with nothing shown when hello-world answers 401 (no refusal redirect)', async ({
    page,
  }) => {
    await mockSession(page, () => true);
    await mockFlags(page, { hello_world: true });
    await page.route(HELLO_WORLD, (route) =>
      route.fulfill({ status: 401, json: { statusCode: 401, message: 'Unauthorized' } }),
    );
    const helloWorldResponse = page.waitForResponse(HELLO_WORLD);
    await page.goto('/');
    await helloWorldResponse;
    await expectPlainDashboard(page);
  });

  test('answers hello-world 404 with nothing shown', async ({ page }) => {
    await mockSession(page, () => true);
    await mockFlags(page, { hello_world: true });
    await page.route(HELLO_WORLD, (route) =>
      route.fulfill({ status: 404, json: { statusCode: 404, message: 'Not Found' } }),
    );
    const helloWorldResponse = page.waitForResponse(HELLO_WORLD);
    await page.goto('/');
    await helloWorldResponse;
    await expectPlainDashboard(page);
  });

  for (const path of ['/login', '/not-authorized']) {
    test(`makes no flags request on ${path} (R8)`, async ({ page }) => {
      await mockSession(page, () => false);
      const flagsRequests: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/v1/shared/flags') flagsRequests.push(request.url());
      });
      await page.goto(path);
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(flagsRequests).toEqual([]);
    });
  }
});
