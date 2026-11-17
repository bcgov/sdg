import { expect, type Page, test } from '@playwright/test';

const HEADER_SCRIPT = '/shared-ui/header/v1/sdg-header.js';

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
  const links = [nav.getByRole('link', { name: 'Home' }), nav.getByRole('link', { name: 'Help' })];
  await expect(links[1]!).toBeVisible();
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
    const help = await navBoxes(page, '/help');
    expect(home).toEqual(none);
    expect(help).toEqual(none);

    // Only the selected link is bold (faux bold), with the border and background (R5).
    const nav = page.locator('sdg-header');
    const selected = nav.getByRole('link', { name: 'Help' });
    const other = nav.getByRole('link', { name: 'Home' });
    await expect(selected).toHaveCSS('border-bottom', '2px solid rgb(37, 90, 144)');
    await expect(selected).toHaveCSS('background-color', 'rgb(241, 248, 254)');
    await expect(selected).not.toHaveCSS('text-shadow', 'none');
    await expect(other).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(other).toHaveCSS('text-shadow', 'none');
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
    await expect(header.getByRole('link', { name: 'Help' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await expect(header.getByRole('link', { name: 'Help' })).toBeHidden();
  });

  test('reserves the header height and hides the raw nav links while the script is missing (R20, R21)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signedOut(page);
    await page.route(`**${HEADER_SCRIPT}`, (route) => route.abort());
    await page.goto('/');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Welcome to SDG');

    const header = page.locator('sdg-header');
    expect(await header.evaluate((el) => el.matches(':defined'))).toBe(false);
    expect((await page.getByRole('main').boundingBox())!.y).toBe(104);
    await expect(header.locator('a[slot="nav"]')).toHaveCount(2);
    await expect(header.locator('a[slot="nav"]:visible')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Log In' })).toHaveCount(0);
  });

  test('renders on a page from another origin that loads the script with a plain tag (R19)', async ({
    page,
    context,
    baseURL,
    browserName,
  }) => {
    const scriptURL = new URL(HEADER_SCRIPT, baseURL).href;
    // The local dev server's http base URL needs two concessions a real external site (public, https) never meets:
    // Chromium lets only a granted secure origin reach localhost (Local Network Access), and WebKit treats an
    // http://localhost script on an https page as mixed content.
    const insecureBase = scriptURL.startsWith('http:');
    const external =
      insecureBase && browserName === 'webkit' ? 'http://external.example/' : 'https://external.example/';
    if (insecureBase && browserName === 'chromium') {
      await context.grantPermissions(['local-network-access'], { origin: external });
    }
    await page.route(external, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html>
<html lang="en">
  <head><title>External</title><script src="${scriptURL}"></script></head>
  <body>
    <sdg-header site-title="External Service" login-href="/x"><a slot="nav" href="/">Start</a></sdg-header>
  </body>
</html>`,
      }),
    );
    await page.goto(external);

    const header = page.locator('sdg-header');
    await expect(header.getByRole('banner').getByText('External Service')).toBeVisible();
    await expect(header.getByRole('link', { name: 'Log In' })).toHaveAttribute('href', '/x');
    await expect(header.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Start' })).toBeVisible();
  });
});
