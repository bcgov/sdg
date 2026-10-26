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
  test('shows Sign in when signed out and starts the BFF login', async ({ page }) => {
    await mockCurrentUser(page, () => false);
    await page.route('**/api/auth/login**', (route) => route.fulfill({ body: 'login', contentType: 'text/plain' }));
    await page.goto('/?tab=reports');

    const signIn = page.getByRole('banner').getByRole('link', { name: 'Sign in' });
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveCSS('text-decoration-line', 'none');
    await expect(page.getByRole('button', { name: /Account menu/ })).toHaveCount(0);

    const loginRequest = page.waitForRequest('**/api/auth/login**');
    await signIn.click();
    const url = new URL((await loginRequest).url());
    expect(url.pathname).toBe('/api/auth/login');
    expect(url.searchParams.get('returnTo')).toBe('/?tab=reports');
  });

  test('shows the avatar menu with name, email and Log out when signed in', async ({ page }) => {
    await mockCurrentUser(page, () => true);
    await page.goto('/');

    const trigger = page.getByRole('banner').getByRole('button', { name: 'Account menu for Ada Lovelace' });
    await expect(trigger).toHaveText('AL');
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
    const banner = await page.getByRole('banner').boundingBox();
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox!.x + triggerBox!.width).toBeGreaterThan(banner!.x + banner!.width * 0.75);

    await trigger.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Ada Lovelace')).toBeVisible();
    await expect(menu.getByText('ada@example.com')).toBeVisible();
    const logout = menu.getByRole('menuitem', { name: 'Log out' });
    await expect(logout).toBeVisible();
    const label = logout.getByText('Log out');
    const icon = logout.locator('svg[data-icon="right-from-bracket"]');
    expect((await icon.boundingBox())!.x).toBeLessThan((await label.boundingBox())!.x);
    const danger = await label.evaluate((el) => getComputedStyle(el).color);
    const name = await menu.getByText('Ada Lovelace').evaluate((el) => getComputedStyle(el).color);
    expect(danger).not.toBe(name);
  });

  test('never shows the avatar or Log out as selected unless hovered or keyboard-focused', async ({ page }) => {
    await mockCurrentUser(page, () => true);
    await page.goto('/');
    const transparent = 'rgba(0, 0, 0, 0)';
    const trigger = page.getByRole('banner').getByRole('button', { name: 'Account menu for Ada Lovelace' });
    const logout = page.getByRole('menuitem', { name: 'Log out' });

    // Open with the pointer: the trigger is "pressed" and still hovered, the first item has focus.
    await trigger.click();
    await expect(logout).toBeVisible();
    await expect(trigger).toHaveCSS('background-color', transparent);
    await expect(logout).toHaveCSS('background-color', transparent);
    // Focus moves into the popover; neither it nor the menu may draw a focus outline around the whole menu.
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el
        ? `${el.tagName}.${el.className}[role=${el.getAttribute('role')}] outline=${getComputedStyle(el).outlineStyle}`
        : 'none';
    });
    expect(focused, 'focused element after opening').not.toMatch(/outline=(auto|solid)/);
    await expect(page.getByRole('menu')).toHaveCSS('outline-style', 'none');

    // Hovering the item highlights it in the danger tint.
    await logout.hover();
    await expect(logout).not.toHaveCSS('background-color', transparent);
    await page.mouse.move(0, 400);
    await expect(logout).toHaveCSS('background-color', transparent);

    // Closed by the pointer: focus returns to the trigger, which must not look selected.
    await page.mouse.click(10, 400);
    await expect(logout).toBeHidden();
    await expect(trigger).toHaveCSS('background-color', transparent);
    await expect(trigger).toHaveCSS('outline-style', 'none');
    await trigger.hover();
    await expect(trigger).toHaveCSS('background-color', transparent);

    // Keyboard users still get a focus ring on the trigger and a highlighted item.
    await page.mouse.move(0, 400);
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(logout).toBeFocused();
    await expect(logout).not.toHaveCSS('background-color', transparent);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).not.toHaveCSS('outline-style', 'none');
  });

  test('keeps the avatar the same size on hover, so the nav does not shift', async ({ page }) => {
    await mockCurrentUser(page, () => true);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const banner = page.getByRole('banner');
    const trigger = banner.getByRole('button', { name: 'Account menu for Ada Lovelace' });
    const help = banner.getByRole('link', { name: 'Help' });
    await expect(trigger).toBeVisible();
    await page.mouse.move(0, 400);
    const [triggerAtRest, helpAtRest] = await Promise.all([trigger.boundingBox(), help.boundingBox()]);

    await trigger.hover();
    const [triggerHovered, helpHovered] = await Promise.all([trigger.boundingBox(), help.boundingBox()]);
    expect(triggerHovered).toEqual(triggerAtRest);
    expect(helpHovered).toEqual(helpAtRest);
    expect(triggerAtRest?.width).toBe(32);
  });

  test('logs out through the BFF and returns to Sign in', async ({ page }) => {
    let signedIn = true;
    await mockCurrentUser(page, () => signedIn);
    await page.route('**/api/auth/logout', (route) => {
      signedIn = false;
      return route.fulfill({ json: { redirectUrl: '/' } });
    });
    await page.goto('/');

    await page.getByRole('button', { name: 'Account menu for Ada Lovelace' }).click();
    const logoutRequest = page.waitForRequest('**/api/auth/logout');
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    expect((await logoutRequest).method()).toBe('POST');

    await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Account menu/ })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/');
  });
});
