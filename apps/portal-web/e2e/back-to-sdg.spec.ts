import { expect, type Page, test } from '@playwright/test';

import { serveExternalSite } from './external-site';

async function signedOut(page: Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 401, json: { statusCode: 401, message: 'Unauthorized' } }),
  );
}

test.describe('Back to SDG in the shared header', () => {
  test('links an external site back to the SDG page in return-to, on every page of that site in the tab', async ({
    page,
    context,
    baseURL,
    browserName,
  }) => {
    const external = await serveExternalSite({ page, context, baseURL, browserName });
    await page.goto(`${external}?return-to=${encodeURIComponent('/help?topic=fees')}`);

    const header = page.locator('sdg-header');
    const back = header.getByRole('link', { name: 'Back to SDG' });
    await expect(back).toHaveAttribute('href', new URL('/help?topic=fees', baseURL).href);
    // It sits at the start of the grey row, Log In at its end.
    const [backBox, logInBox] = await Promise.all(
      [back, header.getByRole('link', { name: 'Log In' })].map((l) => l.boundingBox()),
    );
    expect(backBox!.x).toBeLessThan(logInBox!.x);
    expect(backBox!.y + backBox!.height).toBeLessThanOrEqual(48);

    // The next page of the external site carries no return-to; the tab remembers it.
    await page.getByRole('link', { name: 'Next' }).click();
    await expect(page).toHaveURL(`${external}next`);
    await expect(back).toHaveAttribute('href', new URL('/help?topic=fees', baseURL).href);

    await back.click();
    await expect(page).toHaveURL(new URL('/help?topic=fees', baseURL).href);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Help');
  });

  test("links to SDG's home page when an SDG link carries no return-to", async ({
    page,
    context,
    baseURL,
    browserName,
  }) => {
    const external = await serveExternalSite({ page, context, baseURL, browserName });
    await signedOut(page);
    await page.goto('/help');
    // A plain link out of SDG: the visitor arrives with only SDG's origin as the referrer.
    await page.evaluate((href) => {
      const link = Object.assign(document.createElement('a'), { href, textContent: 'Partner' });
      document.body.append(link);
    }, `${external}next`);
    await page.getByRole('link', { name: 'Partner' }).click();
    await expect(page).toHaveURL(`${external}next`);

    await expect(page.locator('sdg-header').getByRole('link', { name: 'Back to SDG' })).toHaveAttribute(
      'href',
      new URL('/', baseURL).href,
    );
  });

  test('shows no Back to SDG on SDG itself, even with return-to', async ({ page }) => {
    await signedOut(page);
    await page.goto('/?return-to=%2Fhelp');

    const header = page.locator('sdg-header');
    await expect(header.getByRole('link', { name: 'Log In' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Back to SDG' })).toHaveCount(0);
  });

  test('shows no Back to SDG on an external site the visitor did not reach from SDG', async ({
    page,
    context,
    baseURL,
    browserName,
  }) => {
    const external = await serveExternalSite({ page, context, baseURL, browserName });
    await page.goto(external);

    const header = page.locator('sdg-header');
    await expect(header.getByRole('link', { name: 'Log In' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Back to SDG' })).toHaveCount(0);
  });
});
