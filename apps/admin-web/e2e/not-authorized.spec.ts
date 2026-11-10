import { expect, test } from '@playwright/test';

import { mockSession } from './support/mock-admin-api';

// Where admin-api sends a sign-in core-api refused (AE1): no session exists, so /api/auth/me answers 401.
test.describe('admin-web not-authorized page', () => {
  test('explains the admin client role and offers sign-out and a different account', async ({ page }) => {
    await mockSession(page, () => false);
    await page.goto('/not-authorized');

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(
      'You are not authorized to use SDG administration',
    );
    await expect(main).toContainText('requires the admin client role');
    await expect(main.getByRole('link', { name: 'Sign in with a different account' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2F',
    );
    await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2F',
    );
  });

  test("signs out through admin-api's logout and follows its redirect", async ({ page }) => {
    await mockSession(page, () => false);
    await page.route('**/api/auth/logout', (route) => route.fulfill({ json: { redirectUrl: '/' } }));
    await page.goto('/not-authorized');

    const logoutRequest = page.waitForRequest('**/api/auth/logout');
    await page.getByRole('main').getByRole('button', { name: 'Sign out' }).click();
    expect((await logoutRequest).method()).toBe('POST');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('SDG administration');
  });
});
