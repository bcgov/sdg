import { expect, type Page } from '@playwright/test';
import { test } from '@repo/playwright-config';

import { LOADER_PATH, serveExternalSite } from './external-site';

async function signedOut(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 401, json: { statusCode: 401, message: 'Unauthorized' } }),
  );
}

/** The nav links' boxes once BC Sans has loaded (a late font would resize them between measurements). */
async function navBoxes(page: Page, path: string) {
  await page.goto(path);
  // Slotted links are the element's light-DOM children, outside the shadow <header>'s DOM subtree.
  const nav = page.locator('sdg-header');
  const links = ['Home', 'Services', 'Help', 'Contact us'].map((name) => nav.getByRole('link', { name }));
  await expect(links[3]!).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  return Promise.all(links.map((link) => link.boundingBox()));
}

test.describe('portal-web shared header', () => {
  test('keeps every nav link in place whichever one is selected (AE3)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signedOut(page);
    // An unknown path selects neither link.
    const none = await navBoxes(page, '/does-not-exist');
    await expect(page.locator('sdg-header [aria-current="page"]')).toHaveCount(0);
    const home = await navBoxes(page, '/');
    const services = await navBoxes(page, '/services');
    const help = await navBoxes(page, '/help');
    const contactUs = await navBoxes(page, '/contact-us');
    expect(home).toEqual(none);
    expect(services).toEqual(none);
    expect(help).toEqual(none);
    expect(contactUs).toEqual(none);

    // Links look like tertiary buttons; only the selected one is bold (faux bold) (R5).
    const nav = page.locator('sdg-header');
    const selected = nav.getByRole('link', { name: 'Contact us' });
    const other = nav.getByRole('link', { name: 'Home' });
    await expect(selected).not.toHaveCSS('text-shadow', 'none');
    await expect(other).toHaveCSS('text-shadow', 'none');
    await Promise.all(
      [selected, other].flatMap((link) => [
        expect(link).toHaveCSS('background-color', 'rgba(255, 255, 255, 0)'),
        expect(link).toHaveCSS('color', 'rgb(45, 45, 45)'),
        expect(link).toHaveCSS('border-radius', '4px'),
        expect(link).toHaveCSS('text-decoration-line', 'none'),
        link.boundingBox().then((box) => expect(box!.height).toBe(40)),
      ]),
    );

    // The tertiary button's hover and pressed backgrounds.
    await other.hover();
    await expect(other).toHaveCSS('background-color', 'rgb(236, 234, 232)');
    await page.mouse.down();
    await expect(other).toHaveCSS('background-color', 'rgb(224, 222, 220)');
    await page.mouse.up();
  });

  test('caps the contents at 1100px, centered and in line with the page, and spans the page with fluid', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await signedOut(page);
    await page.goto('/');
    const header = page.locator('sdg-header');
    const containers = header.locator('[data-part="container"]');
    await expect(containers).toHaveCount(2);

    // Rows span the page; their contents stop at 1100px, centered, with the same edges as the page's content column.
    const rows = await Promise.all(
      ['utility', 'main'].map((part) => header.locator(`[data-part="${part}"]`).boundingBox()),
    );
    expect(rows.map((box) => box?.width)).toEqual([1440, 1440]);
    for (const box of await Promise.all([containers.nth(0).boundingBox(), containers.nth(1).boundingBox()])) {
      // 1100px of content plus 16px of padding on each side.
      expect(box?.width).toBe(1132);
      expect(box?.x).toBe(154);
    }
    // Same box and same 1rem side padding as the page's content column, so the content edges line up.
    const column = await page.locator('#main-content > div').boundingBox();
    const headerBox = await containers.nth(1).boundingBox();
    expect({ x: headerBox?.x, width: headerBox?.width }).toEqual({ x: column?.x, width: column?.width });

    await header.evaluate((element) => element.setAttribute('fluid', ''));
    await expect(containers.first()).toHaveClass(/container-fluid/);
    for (const box of await Promise.all([containers.nth(0).boundingBox(), containers.nth(1).boundingBox()])) {
      expect(box?.width).toBe(1440);
    }
  });

  test('opens, walks and closes the narrow-screen menu with the keyboard (AE6)', async ({ page, browserName }) => {
    // WebKit, like Safari's default, tabs only to form controls; Alt+Tab moves through links as well.
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    await page.setViewportSize({ width: 375, height: 800 });
    await signedOut(page);
    await page.goto('/');
    const header = page.locator('sdg-header');
    const toggle = header.getByRole('button', { name: 'Menu' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const toggleBox = (await toggle.boundingBox())!;
    expect(toggleBox.width).toBe(toggleBox.height);

    // Tab from the top of the page: the skip link, Log In, then the menu button.
    await page.keyboard.press(tab);
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press(tab);
    await expect(header.getByRole('link', { name: 'Log In' })).toBeFocused();
    await page.keyboard.press(tab);
    await expect(toggle).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press(tab);
    await expect(header.getByRole('link', { name: 'Home' })).toBeFocused();
    await page.keyboard.press(tab);
    await expect(header.getByRole('link', { name: 'Services' })).toBeFocused();
    await page.keyboard.press(tab);
    await expect(header.getByRole('link', { name: 'Help' })).toBeFocused();
    await page.keyboard.press(tab);
    await expect(header.getByRole('link', { name: 'Contact us' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await expect(header.getByRole('link', { name: 'Contact us' })).toBeHidden();
  });

  test('shows SDG, a divider and the site title inline, cut off with an ellipsis, on wide screens', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signedOut(page);
    await page.goto('/');
    const header = page.locator('sdg-header');
    await expect(header.locator('[data-part="brand"]')).toHaveText('SDG');
    await expect(header.locator('[data-part="separator"]')).toHaveCount(0);

    await header.evaluate((el) => el.setAttribute('site-title', 'A very long service title '.repeat(8).trim()));
    const title = header.locator('[data-part="main"] [data-part="title"]');
    await expect(title).toBeVisible();
    await expect(header.locator('[data-part="separator"]')).toBeVisible();
    await expect(header.locator('[data-part="title-row"]')).toBeHidden();
    await expect(header.locator('[data-part="logo-full"]')).toBeVisible();
    await expect(header.locator('[data-part="logo-mark"]')).toBeHidden();
    expect((await header.locator('[data-part="logo-full"]').boundingBox())!.height).toBe(44);
    // The logo and SDG sit 8px apart: half the row's 16px gap.
    const [logoBox, brandBox] = await Promise.all(
      ['logo-full', 'brand'].map((part) => header.locator(`[data-part="${part}"]`).boundingBox()),
    );
    expect(brandBox!.x - (logoBox!.x + logoBox!.width)).toBeCloseTo(8, 0);
    await expect(title).toHaveCSS('font-weight', '400');
    await expect(title).toHaveCSS('text-overflow', 'ellipsis');
    // One line, cut short rather than wrapped, and the nav keeps its place on the row.
    expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect((await title.boundingBox())!.height).toBeLessThan(32);
    await expect(header.getByRole('link', { name: 'Contact us' })).toBeVisible();
    expect((await page.getByRole('main').boundingBox())!.y).toBe(104);
  });

  test('shows the logo mark and moves the site title to its own 38px row on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signedOut(page);
    await page.goto('/');
    const header = page.locator('sdg-header');
    await expect(header.locator('[data-part="logo-mark"]')).toBeVisible();
    await expect(header.locator('[data-part="logo-full"]')).toBeHidden();
    // Log In collapses to a square icon button that keeps its accessible name.
    const logIn = header.getByRole('link', { name: 'Log In' });
    const logInBox = (await logIn.boundingBox())!;
    expect(logInBox.width).toBe(logInBox.height);
    await expect(logIn.getByText('Log In')).toHaveCSS('clip-path', 'inset(50%)');
    // The mark alone is the full logo cut off before the wordmark: same 44px height, so the same size as in the full logo.
    expect((await header.locator('[data-part="logo-mark"]').boundingBox())!.height).toBe(44);
    expect((await page.getByRole('main').boundingBox())!.y).toBe(104);

    await header.evaluate((el) => el.setAttribute('site-title', 'Service Portal'));
    const row = header.locator('[data-part="title-row"]');
    await expect(row).toHaveText('Service Portal');
    await expect(header.locator('[data-part="main"] [data-part="title"]')).toBeHidden();
    await expect(header.locator('[data-part="separator"]')).toBeHidden();
    expect((await row.boundingBox())!.height).toBe(38);
    expect((await page.getByRole('main').boundingBox())!.y).toBe(142);
  });

  test('reserves the small-screen title row too while the loader is missing', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signedOut(page);
    await page.route(`**${LOADER_PATH}`, (route) => route.abort());
    await page.goto('/');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Access services online');
    const header = page.locator('sdg-header');
    expect((await page.getByRole('main').boundingBox())!.y).toBe(104);

    await header.evaluate((el) => el.setAttribute('site-title', 'Service Portal'));
    expect((await page.getByRole('main').boundingBox())!.y).toBe(142);
  });

  test('reserves the header height and hides the raw nav links while the loader is missing (R20, R21)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signedOut(page);
    await page.route(`**${LOADER_PATH}`, (route) => route.abort());
    await page.goto('/');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Access services online');

    const header = page.locator('sdg-header');
    expect(await header.evaluate((el) => el.matches(':defined'))).toBe(false);
    expect((await page.getByRole('main').boundingBox())!.y).toBe(104);
    await expect(header.locator('a[slot="nav"]')).toHaveCount(4);
    await expect(header.locator('a[slot="nav"]:visible')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Log In' })).toHaveCount(0);
  });

  test('renders on a page from another origin that embeds the loader tag with its integrity (R19, R1)', async ({
    page,
    baseURL,
  }) => {
    const external = await serveExternalSite({ page, baseURL });
    await page.goto(external);

    const header = page.locator('sdg-header');
    // The small-screen title row holds a second, hidden copy of the title at this width.
    await expect(header.getByRole('banner').getByText('External Service').filter({ visible: true })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Log In' })).toHaveAttribute('href', '/x');
    await expect(header.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Start' })).toBeVisible();

    // Signed in, Account Settings links back to the SDG that served the header, not to the partner's own origin.
    await header.evaluate((el) => el.setAttribute('user-name', 'Ada Lovelace'));
    await header.getByRole('button', { name: 'Ada Lovelace' }).click();
    await expect(header.getByRole('menuitem', { name: 'Account Settings' })).toHaveAttribute(
      'href',
      new URL('/account-settings', baseURL).href,
    );

    // Log Out is the site's to handle: the header only dispatches sdg-logout.
    await header.evaluate((el) =>
      el.addEventListener('sdg-logout', () => el.setAttribute('data-logged-out', ''), { once: true }),
    );
    await header.getByRole('menuitem', { name: 'Log Out' }).click();
    await expect(header).toHaveAttribute('data-logged-out', '');
  });
});
