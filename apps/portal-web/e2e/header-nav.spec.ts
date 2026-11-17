import { expect, type Page, test } from '@playwright/test';

const user = { id: 'p-1', name: 'Ada Lovelace', email: 'ada@example.com' };

/** Fakes portal-api's /api/auth/me in the browser, so the suite needs no API or Keycloak. */
async function mockCurrentUser(page: Page, signedIn: boolean) {
  await page.route('**/api/auth/me', (route) =>
    signedIn
      ? route.fulfill({ json: user })
      : route.fulfill({ status: 401, json: { statusCode: 401, message: 'Unauthorized' } }),
  );
}

async function openMenu(page: Page) {
  const toggle = page.locator('sdg-header').getByRole('button', { name: 'Menu' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return toggle;
}

test.describe('portal-web header nav', () => {
  test('shows Home and Help inline with no menu button on wide screens, Help selected on /help', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockCurrentUser(page, false);
    await page.goto('/help');
    const header = page.locator('sdg-header');
    await expect(header.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(header.locator('a[slot="nav"]')).toHaveText(['Home', 'Help']);
    await expect(header.getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'page');
    await expect(header.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    await expect(header.getByRole('button', { name: 'Menu' })).toHaveCount(0);

    // The nav sits on the main row, right of the site title and below Log In's utility row.
    const [title, home, logIn] = await Promise.all(
      [
        header.getByText('SDG', { exact: true }),
        header.getByRole('link', { name: 'Home' }),
        header.getByRole('link', { name: 'Log In' }),
      ].map((l) => l.boundingBox()),
    );
    expect(home!.x).toBeGreaterThan(title!.x + title!.width);
    expect(home!.y).toBeGreaterThanOrEqual(logIn!.y + logIn!.height);
  });

  test('navigates client-side from the nav and moves the selected item', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockCurrentUser(page, false);
    await page.goto('/');
    const header = page.locator('sdg-header');
    await expect(header.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    // A full reload would drop this marker.
    await page.evaluate(() => Object.assign(window, { stayedOnPage: true }));

    await header.getByRole('link', { name: 'Help' }).click();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Help');
    await expect(header.getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'page');
    await expect(header.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(await page.evaluate(() => 'stayedOnPage' in window)).toBe(true);
  });

  test('keeps Log In in the utility row and the nav behind the menu button on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockCurrentUser(page, false);
    await page.goto('/');
    const header = page.locator('sdg-header');
    await expect(header.getByRole('link', { name: 'Log In' })).toBeVisible();
    const toggle = header.getByRole('button', { name: 'Menu' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(header.getByRole('link', { name: 'Home' })).toBeHidden();

    await openMenu(page);
    const home = header.getByRole('link', { name: 'Home' });
    const help = header.getByRole('link', { name: 'Help' });
    await expect(home).toBeVisible();
    await expect(home).toHaveAttribute('aria-current', 'page');
    // A stacked list under the header that overlays the page instead of pushing it down.
    const [homeBox, helpBox, mainBox] = await Promise.all(
      [home, help, page.getByRole('main')].map((l) => l.boundingBox()),
    );
    expect(helpBox!.y).toBeGreaterThan(homeBox!.y);
    expect(homeBox!.y).toBeGreaterThanOrEqual(mainBox!.y);
    expect(mainBox!.y).toBeCloseTo(104, 0);

    await help.click();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Help');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(help).toBeHidden();
  });

  test('keeps the name and Log Out in the utility row on narrow screens when signed in', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockCurrentUser(page, true);
    await page.goto('/');
    const header = page.locator('sdg-header');
    await expect(header.getByRole('button', { name: 'Menu' })).toBeVisible();
    await expect(header.getByText('Ada Lovelace')).toBeVisible();
    await expect(header.getByRole('button', { name: 'Log Out' })).toBeVisible();
  });

  test('switches back to the inline nav when the screen widens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockCurrentUser(page, false);
    await page.goto('/');
    await openMenu(page);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('button', { name: 'Menu' })).toHaveCount(0);
    await expect(page.locator('sdg-header').getByRole('link', { name: 'Help' })).toBeVisible();
  });
});
