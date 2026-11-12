import { expect, type Page, test } from '@playwright/test';

import { mockSession } from './support/mock-console-api';

/** The not-authorized card: no app shell around it, and a way out with a different account. */
async function expectNotAuthorizedCard(page: Page) {
  await expect(page).toHaveURL(/\/not-authorized$/);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('You are not authorized to use SDG Console');
  await expect(main).toContainText('requires the admin client role');
  await expect(main.getByRole('link', { name: 'Sign in with a different account' })).toHaveAttribute(
    'href',
    '/api/auth/login?returnTo=%2F',
  );
  await expect(page.getByRole('navigation')).toHaveCount(0);
}

test.describe('console-web not-authorized page', () => {
  // Where console-api sends a sign-in core-api refused: no session exists, so /api/auth/me answers 401.
  test('explains the admin client role in the card layout and offers sign-out and a different account', async ({
    page,
  }) => {
    await mockSession(page, () => false);
    await page.goto('/not-authorized');
    await expectNotAuthorizedCard(page);
  });

  test('lands a signed-in account core-api refuses (its 403) on the not-authorized card', async ({ page }) => {
    await mockSession(page, () => true);
    await page.route('**/api/v1/console/service-clients**', (route) =>
      route.fulfill({ status: 403, json: { statusCode: 403, message: 'Forbidden resource' } }),
    );
    await page.goto('/service-clients');
    await expectNotAuthorizedCard(page);
  });

  test("signs out through console-api's logout and ends on the sign-in card", async ({ page }) => {
    await mockSession(page, () => false);
    await page.route('**/api/auth/logout', (route) => route.fulfill({ json: { redirectUrl: '/' } }));
    await page.goto('/not-authorized');

    const logoutRequest = page.waitForRequest('**/api/auth/logout');
    await page.getByRole('main').getByRole('button', { name: 'Sign out' }).click();
    expect((await logoutRequest).method()).toBe('POST');
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('SDG Console');
  });
});
