import { expect, type Page, test } from '@playwright/test';

/**
 * PR environments start with no flags (KTD14), so the flag list and hello-world are faked in the browser, as is
 * /api/auth/me (signed out): the suite needs no API, database or Keycloak.
 */
async function signedOut(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 401, json: { statusCode: 401, message: 'Unauthorized' } }),
  );
}

test.describe('portal-web feature flags', () => {
  test('Should show "Hello, world!" to a signed-out visitor when hello_world is on (AE2)', async ({ page }) => {
    await signedOut(page);
    await page.route('**/api/v1/shared/flags', (route) => route.fulfill({ json: { hello_world: true } }));
    await page.route('**/api/v1/shared/hello-world', (route) => route.fulfill({ json: { message: 'Hello, world!' } }));
    await page.goto('/');

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Welcome to SDG');
    await expect(main.getByText('Hello, world!')).toBeVisible();
    await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
  });

  test('Should render the home page without hello-world when the flag list fails (AE8)', async ({ page }) => {
    await signedOut(page);
    await page.route('**/api/v1/shared/flags', (route) =>
      route.fulfill({ status: 503, json: { statusCode: 503, message: 'Service Unavailable' } }),
    );
    let helloWorldRequests = 0;
    await page.route('**/api/v1/shared/hello-world', (route) => {
      helloWorldRequests += 1;
      return route.fulfill({ json: { message: 'Hello, world!' } });
    });
    const flagsResponse = page.waitForResponse('**/api/v1/shared/flags');
    await page.goto('/');
    await flagsResponse;

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Welcome to SDG');
    await page.waitForLoadState('networkidle');
    await expect(main.getByText('Hello, world!')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(helloWorldRequests).toBe(0);
  });
});
