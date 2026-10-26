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
  const toggle = page.getByRole('banner').getByRole('button', { name: 'Menu' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return { toggle, panel: page.locator(`#${await toggle.getAttribute('aria-controls')}`) };
}

test.describe('portal-web header hamburger menu', () => {
  test('keeps Sign in inline with no hamburger on wide screens', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockCurrentUser(page, false);
    await page.goto('/');
    await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Menu' })).toHaveCount(0);
  });

  test('collapses Sign in into a full-width panel below the header on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockCurrentUser(page, false);
    await page.goto('/');
    const banner = page.getByRole('banner');
    const menuButton = banner.getByRole('button', { name: 'Menu' });
    await expect(menuButton).toBeVisible();
    // The bars icon must actually draw, not just exist as markup.
    const icon = menuButton.locator('svg[data-icon="bars"] path');
    await expect(icon).toBeVisible();
    expect((await icon.boundingBox())!.width).toBeGreaterThan(8);
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);

    const { toggle, panel } = await openMenu(page);
    const signIn = panel.getByRole('link', { name: 'Sign in' });
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute('href', '/api/auth/login?returnTo=%2F');
    const headerBox = (await banner.boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.y).toBeCloseTo(headerBox.y + headerBox.height, 0);
    expect(panelBox.x).toBeCloseTo(0, 0);
    expect(panelBox.width).toBeCloseTo(headerBox.width, 0);
    // Stretches to the viewport bottom, with Sign in pinned at the bottom of it.
    expect(panelBox.y + panelBox.height).toBeCloseTo(800, 0);
    // Sign in's fill reaches the viewport bottom: no panel border below it.
    const signInBox = (await signIn.boundingBox())!;
    expect(signInBox.y + signInBox.height).toBeCloseTo(800, 0);
    await expect(panel).toHaveCSS('border-bottom-width', '0px');
    // The panel sits over the page content rather than pushing it down.
    const mainTop = (await page.getByRole('main').boundingBox())!.y;
    expect(mainTop).toBeCloseTo(headerBox.y + headerBox.height, 0);

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toHaveCount(0);
    await expect(toggle).toBeFocused();
  });

  test('folds the profile and Log out into the panel when signed in', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockCurrentUser(page, true);
    await page.goto('/');
    await expect(page.getByRole('banner').getByRole('button', { name: 'Menu' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Account menu/ })).toHaveCount(0);

    const { panel } = await openMenu(page);
    await expect(panel.getByText('Ada Lovelace')).toBeVisible();
    await expect(panel.getByText('ada@example.com')).toBeVisible();
    const logout = panel.getByRole('button', { name: 'Log out' });
    await expect(logout).toBeVisible();
    const danger = await logout.getByText('Log out').evaluate((el) => getComputedStyle(el).color);
    const name = await panel.getByText('Ada Lovelace').evaluate((el) => getComputedStyle(el).color);
    expect(danger).not.toBe(name);
    // Log out spans the whole row, its icon and label centred in it.
    const [panelBox, logoutBox, iconBox, labelBox] = await Promise.all(
      [panel, logout, logout.locator('svg[data-icon="right-from-bracket"]'), logout.getByText('Log out')].map((l) =>
        l.boundingBox(),
      ),
    );
    expect(logoutBox!.x).toBeCloseTo(panelBox!.x, 0);
    expect(logoutBox!.width).toBeCloseTo(panelBox!.width, 0);
    const contentCentre = (iconBox!.x + labelBox!.x + labelBox!.width) / 2;
    expect(contentCentre).toBeCloseTo(panelBox!.x + panelBox!.width / 2, 0);
  });

  test('scrolls only the items, keeping the profile on top and Log out at the bottom', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 250 });
    await mockCurrentUser(page, true);
    await page.goto('/');
    const { panel } = await openMenu(page);

    const items = panel.locator('.panel-items');
    const m = await items.evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      panelScrolls: el.parentElement!.scrollHeight > el.parentElement!.clientHeight,
    }));
    expect(m.overflowY).toBe('auto');
    expect(m.scrollHeight).toBeGreaterThan(m.clientHeight);
    expect(m.panelScrolls).toBe(false);
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.y + panelBox.height).toBeCloseTo(250, 0);

    const name = panel.getByText('Ada Lovelace');
    const logout = panel.getByRole('button', { name: 'Log out' });
    await expect(name).toBeInViewport({ ratio: 1 });
    await expect(logout).toBeInViewport({ ratio: 1 });
    await items.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(panel.getByRole('link', { name: 'Help' })).toBeInViewport({ ratio: 1 });
    await expect(name).toBeInViewport({ ratio: 1 });
    await expect(logout).toBeInViewport({ ratio: 1 });
  });

  test('scrolls the whole panel when the viewport is too short for its sections', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 160 });
    await mockCurrentUser(page, true);
    await page.goto('/');
    const { panel } = await openMenu(page);

    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.y + panelBox.height).toBeCloseTo(160, 0);
    const logout = panel.getByRole('button', { name: 'Log out' });
    await expect(logout).not.toBeInViewport({ ratio: 1 });
    await panel.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(logout).toBeInViewport({ ratio: 1 });
  });

  test('shows the Home and Help nav items inline before Sign in on wide screens', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockCurrentUser(page, false);
    await page.goto('/help');
    const nav = page.getByRole('banner').getByRole('navigation', { name: 'Main' });
    const help = nav.getByRole('link', { name: 'Help' });
    await expect(help).toHaveAttribute('aria-current', 'page');
    await expect(help).toHaveCSS('font-weight', '700');
    // B.C. Primary Blue (#013366) for every nav item and Sign in.
    await Promise.all(
      [help, nav.getByRole('link', { name: 'Home' }), page.getByRole('link', { name: 'Sign in' })].map((link) =>
        expect(link).toHaveCSS('color', 'rgb(1, 51, 102)'),
      ),
    );
    const home = nav.getByRole('link', { name: 'Home' });
    const signIn = page.getByRole('banner').getByRole('link', { name: 'Sign in' });
    const [homeBox, helpBox, signInBox] = await Promise.all([home, help, signIn].map((l) => l.boundingBox()));
    expect(homeBox!.x).toBeLessThan(helpBox!.x);
    expect(helpBox!.x).toBeLessThan(signInBox!.x);
    expect(helpBox!.y).toBeCloseTo(signInBox!.y, 0);
  });

  test('lists the nav items in the panel and closes it after navigating', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockCurrentUser(page, false);
    await page.goto('/');
    const { toggle, panel } = await openMenu(page);
    const nav = panel.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link')).toHaveText(['Home', 'Help']);
    await expect(nav.getByRole('link', { name: 'Home' })).toHaveCSS('color', 'rgb(1, 51, 102)');
    // Sign in is a B.C. primary button (#013366 fill, white text) spanning the row, its label centred.
    const signIn = panel.getByRole('link', { name: 'Sign in' });
    await expect(signIn).toHaveCSS('background-color', 'rgb(1, 51, 102)');
    await expect(signIn).toHaveCSS('color', 'rgb(255, 255, 255)');
    const [panelBox, signInBox] = await Promise.all([panel.boundingBox(), signIn.boundingBox()]);
    expect(signInBox!.width).toBeCloseTo(panelBox!.width, 0);
    const labelCentre = await signIn.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const box = range.getBoundingClientRect();
      return box.x + box.width / 2;
    });
    expect(labelCentre).toBeCloseTo(panelBox!.x + panelBox!.width / 2, 0);
    const homeBox = (await nav.getByRole('link', { name: 'Home' }).boundingBox())!;
    const helpBox = (await nav.getByRole('link', { name: 'Help' }).boundingBox())!;
    expect(helpBox.y).toBeGreaterThan(homeBox.y);

    await nav.getByRole('link', { name: 'Help' }).click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Help');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toHaveCount(0);
  });

  test('shows the B.C. emblem instead of the full logo on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockCurrentUser(page, false);
    await page.goto('/');
    const logo = page.getByRole('banner').getByTitle('Government of British Columbia');
    const emblem = logo.locator('svg#bcgov-emblem-header');
    await expect(emblem).toBeVisible();
    await expect(logo.locator('svg#bcgov-logo-header')).toHaveCount(0);
    // The sky (first path) is drawn at the same size in both, with the logo's own margins around it.
    const narrowSvg = (await emblem.boundingBox())!;
    const narrowSky = (await emblem.locator('path').first().boundingBox())!;
    await expect(page.getByRole('banner').getByText('SDG')).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    const full = logo.locator('svg#bcgov-logo-header');
    await expect(full).toBeVisible();
    await expect(emblem).toHaveCount(0);
    const wideSvg = (await full.boundingBox())!;
    const wideSky = (await full.locator('path').first().boundingBox())!;
    expect(narrowSvg.height).toBeCloseTo(wideSvg.height, 1);
    expect(narrowSky.height).toBeCloseTo(wideSky.height, 1);
    expect(narrowSky.width).toBeCloseTo(wideSky.width, 1);
    expect(narrowSky.y - narrowSvg.y).toBeCloseTo(wideSky.y - wideSvg.y, 1);
  });

  test('switches back to the inline header when the screen widens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockCurrentUser(page, false);
    await page.goto('/');
    await openMenu(page);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('button', { name: 'Menu' })).toHaveCount(0);
    await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
  });
});
