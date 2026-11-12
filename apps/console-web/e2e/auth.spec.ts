import { expect, test } from '@playwright/test';

import { admin, mockSession } from './support/mock-console-api';

test.describe('console-web sign-in', () => {
  test('shows Sign in on the signed-out landing and starts the BFF login', async ({ page }) => {
    await mockSession(page, () => false);
    await page.route('**/api/auth/login**', (route) => route.fulfill({ body: 'login', contentType: 'text/plain' }));
    await page.goto('/');

    await expect(page).toHaveTitle('SDG Console');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('SDG Console');
    const signIn = page.getByRole('banner').getByRole('link', { name: 'Sign in' });
    await expect(signIn).toBeVisible();
    await expect(page.getByRole('button', { name: /Account menu/ })).toHaveCount(0);

    const loginRequest = page.waitForRequest('**/api/auth/login**');
    await signIn.click();
    const url = new URL((await loginRequest).url());
    expect(url.pathname).toBe('/api/auth/login');
    expect(url.searchParams.get('returnTo')).toBe('/');
  });

  test("shows the administrator's name and Log out when signed in (R15)", async ({ page }) => {
    let signedIn = true;
    await mockSession(page, () => signedIn);
    await page.route('**/api/auth/logout', (route) => {
      signedIn = false;
      return route.fulfill({ json: { redirectUrl: '/' } });
    });
    await page.goto('/');

    await expect(page.getByRole('link', { name: 'Manage service accounts' })).toBeVisible();
    await page
      .getByRole('banner')
      .getByRole('button', { name: `Account menu for ${admin.name}` })
      .click();
    const logoutRequest = page.waitForRequest('**/api/auth/logout');
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    expect((await logoutRequest).method()).toBe('POST');
    await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
  });

  test('shows a retry when sign-in failed because the service is unavailable', async ({ page }) => {
    await mockSession(page, () => false);
    await page.goto('/?authError=unavailable');
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
    await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      /^\/api\/auth\/login\?returnTo=/,
    );
  });

  test('sends the administrator back to sign-in with "session ended" when console-api answers 401 (R32)', async ({
    page,
  }) => {
    await mockSession(page, () => true);
    await page.route('**/api/v1/console/service-clients**', (route) =>
      route.fulfill({ status: 401, json: { statusCode: 401, message: 'Unauthorized' } }),
    );
    await page.goto('/service-clients');
    await expect(page.getByRole('alert')).toContainText('Your session ended');
    await expect(page).toHaveURL(/\/\?session=ended/);
    await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2Fservice-clients',
    );
  });
});
