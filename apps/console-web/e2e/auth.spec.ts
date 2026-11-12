import { expect, type Page, test } from '@playwright/test';

import { admin, mockSession } from './support/mock-console-api';

/** The sign-in card (/login): the page's only landmark, titled "SDG Console". */
async function expectSignInCard(page: Page) {
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('SDG Console');
  await expect(page.getByRole('navigation')).toHaveCount(0);
}

test.describe('console-web sign-in', () => {
  test('sends a signed-out visitor to the sign-in card and starts the BFF login back to the Dashboard', async ({
    page,
  }) => {
    await mockSession(page, () => false);
    await page.route('**/api/auth/login**', (route) => route.fulfill({ body: 'login', contentType: 'text/plain' }));
    await page.goto('/');

    await expect(page).toHaveTitle('SDG Console');
    await expectSignInCard(page);
    await expect(page.getByRole('main')).toContainText('Sign in with your IDIR to manage SDG.');
    await expect(page.getByRole('button', { name: /Account menu/ })).toHaveCount(0);

    const loginRequest = page.waitForRequest('**/api/auth/login**');
    await page.getByRole('main').getByRole('link', { name: 'Sign in' }).click();
    const url = new URL((await loginRequest).url());
    expect(url.pathname).toBe('/api/auth/login');
    expect(url.searchParams.get('returnTo')).toBe('/');
  });

  test('returns to the page asked for: signed out, /service-clients shows the card with a Sign in back to it', async ({
    page,
  }) => {
    await mockSession(page, () => false);
    await page.goto('/service-clients');

    await expectSignInCard(page);
    await expect(page.getByRole('main').getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2Fservice-clients',
    );
  });

  test('logs out from the account menu and ends on the sign-in card', async ({ page }) => {
    let signedIn = true;
    await mockSession(page, () => signedIn);
    await page.route('**/api/auth/logout', (route) => {
      signedIn = false;
      return route.fulfill({ json: { redirectUrl: '/' } });
    });
    await page.goto('/');

    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await page.getByRole('button', { name: `Account menu for ${admin.name}` }).click();
    const logoutRequest = page.waitForRequest('**/api/auth/logout');
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    expect((await logoutRequest).method()).toBe('POST');
    await expectSignInCard(page);
  });

  test('shows a retry on the card when sign-in failed because the service is unavailable', async ({ page }) => {
    await mockSession(page, () => false);
    await page.goto('/?authError=unavailable');

    await expect(page).toHaveURL(/\/login\?.*authError=unavailable/);
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
    await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/api/auth/login?returnTo=%2F');
  });

  test('sends the administrator to the card with "session ended" when console-api answers 401 (R32)', async ({
    page,
  }) => {
    await mockSession(page, () => true);
    await page.route('**/api/v1/console/service-clients**', (route) =>
      route.fulfill({ status: 401, json: { statusCode: 401, message: 'Unauthorized' } }),
    );
    await page.goto('/service-clients');

    await expect(page.getByRole('alert')).toContainText('Your session ended');
    await expect(page).toHaveURL(/\/login\?.*session=ended/);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2Fservice-clients',
    );
  });
});
