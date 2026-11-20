import { expect, type Page, test } from '@playwright/test';

/**
 * PR environments start with no flags (KTD14), so the flag list is faked in the browser, as is
 * /api/auth/me (signed out): the suite needs no API, database or Keycloak.
 */
async function signedOut(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 401, json: { statusCode: 401, message: 'Unauthorized' } }),
  );
}

test.describe('portal-web feature flags', () => {
  test('Should render the home page with no error when the flag list fails (AE8)', async ({ page }) => {
    await signedOut(page);
    await page.route('**/api/v1/shared/flags', (route) =>
      route.fulfill({ status: 503, json: { statusCode: 503, message: 'Service Unavailable' } }),
    );
    const flagsResponse = page.waitForResponse('**/api/v1/shared/flags');
    await page.goto('/');
    await flagsResponse;

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Access services online');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
