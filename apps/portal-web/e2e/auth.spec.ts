import { expect, type Page, test } from '@playwright/test';

const user = { id: 'p-1', name: 'Ada Lovelace', email: 'ada@example.com' };

/** Fakes portal-api's /api/auth/me in the browser, so the suite needs no API or Keycloak. */
async function mockCurrentUser(page: Page, signedIn: () => boolean) {
  await page.route('**/api/auth/me', (route) =>
    signedIn()
      ? route.fulfill({ json: user })
      : route.fulfill({ status: 401, json: { statusCode: 401, message: 'Unauthorized' } }),
  );
}

test.describe('portal-web auth', () => {
  test('shows Log In when signed out and starts the BFF login', async ({ page }) => {
    await mockCurrentUser(page, () => false);
    await page.route('**/api/auth/login**', (route) => route.fulfill({ body: 'login', contentType: 'text/plain' }));
    await page.goto('/?tab=reports');

    const logIn = page.getByRole('banner').getByRole('link', { name: 'Log In' });
    await expect(logIn).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ada Lovelace' })).toHaveCount(0);

    const loginRequest = page.waitForRequest('**/api/auth/login**');
    await logIn.click();
    const url = new URL((await loginRequest).url());
    expect(url.pathname).toBe('/api/auth/login');
    expect(url.searchParams.get('returnTo')).toBe('/?tab=reports');
  });

  test("shows the user's name as an account menu in the utility row when signed in", async ({ page }) => {
    await mockCurrentUser(page, () => true);
    await page.goto('/');

    const header = page.locator('sdg-header');
    const banner = header.getByRole('banner');
    const account = banner.getByRole('button', { name: 'Ada Lovelace' });
    await expect(account).toBeVisible();
    await expect(account).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('link', { name: 'Log In' })).toHaveCount(0);
    // It sits on the right of the header's top row, above the nav.
    const [bannerBox, accountBox, contactUsBox] = await Promise.all(
      [banner, account, header.getByRole('link', { name: 'Contact us' })].map((l) => l.boundingBox()),
    );
    expect(accountBox!.x + accountBox!.width).toBeGreaterThan(bannerBox!.x + bannerBox!.width * 0.75);
    expect(accountBox!.y + accountBox!.height).toBeLessThanOrEqual(contactUsBox!.y);

    await account.click();
    await expect(account).toHaveAttribute('aria-expanded', 'true');
    await expect(banner.getByRole('menuitem', { name: 'Account Settings' })).toBeFocused();
    await expect(banner.getByRole('menuitem', { name: 'Log Out' })).toBeVisible();
  });

  test('opens Account Settings client-side from the account menu', async ({ page }) => {
    await mockCurrentUser(page, () => true);
    await page.goto('/');
    await page.evaluate(() => Object.assign(window, { notReloaded: true }));

    const banner = page.locator('sdg-header').getByRole('banner');
    await banner.getByRole('button', { name: 'Ada Lovelace' }).click();
    await banner.getByRole('menuitem', { name: 'Account Settings' }).click();

    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Account Settings');
    expect(new URL(page.url()).pathname).toBe('/account-settings');
    expect(await page.evaluate(() => 'notReloaded' in window)).toBe(true);
    await expect(banner.getByRole('menu')).toBeHidden();
  });

  test('sends a signed-out visitor from /account-settings to the BFF login, returning to Account Settings', async ({
    page,
  }) => {
    await mockCurrentUser(page, () => false);
    await page.route('**/api/auth/login**', (route) => route.fulfill({ body: 'login', contentType: 'text/plain' }));

    const loginRequest = page.waitForRequest('**/api/auth/login**');
    await page.goto('/account-settings?tab=profile');
    const url = new URL((await loginRequest).url());
    expect(url.pathname).toBe('/api/auth/login');
    expect(url.searchParams.get('returnTo')).toBe('/account-settings?tab=profile');
    await expect(page).toHaveURL(/\/api\/auth\/login/);
  });

  test('logs out through the BFF and returns to Log In (F3)', async ({ page }) => {
    let signedIn = true;
    await mockCurrentUser(page, () => signedIn);
    await page.route('**/api/auth/logout', (route) => {
      signedIn = false;
      return route.fulfill({ json: { redirectUrl: '/' } });
    });
    await page.goto('/contact-us');

    const logoutRequest = page.waitForRequest('**/api/auth/logout');
    await page.getByRole('banner').getByRole('button', { name: 'Ada Lovelace' }).click();
    await page.getByRole('banner').getByRole('menuitem', { name: 'Log Out' }).click();
    expect((await logoutRequest).method()).toBe('POST');

    await expect(page.getByRole('banner').getByRole('link', { name: 'Log In' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ada Lovelace' })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('shows a retry when sign-in failed because the service is unavailable', async ({ page }) => {
    await mockCurrentUser(page, () => false);
    await page.goto('/?authError=unavailable');

    await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
    const retry = page.getByRole('link', { name: 'Try again' });
    await expect(retry).toHaveAttribute('href', /^\/api\/auth\/login\?returnTo=/);
  });
});
