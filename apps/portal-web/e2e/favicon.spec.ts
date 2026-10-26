import { expect, test } from '@playwright/test';

test.describe('portal-web favicon', () => {
  test('links the B.C. logo emblem as an SVG favicon', async ({ page }) => {
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401, json: { statusCode: 401 } }));
    await page.goto('/');

    const icons = page.locator('link[rel="icon"]');
    await expect(icons).toHaveCount(1);
    await expect(icons).toHaveAttribute('href', '/favicon.svg');
    await expect(icons).toHaveAttribute('type', 'image/svg+xml');
  });

  test('serves a self-contained SVG in the logo colours', async ({ request }) => {
    const res = await request.get('/favicon.svg');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/svg+xml');

    const svg = await res.text();
    expect(svg).toMatch(/^<svg [^>]*viewBox="69\.5 24 278 278"/);
    for (const colour of ['#fff', '#e3a82b', '#234075']) expect(svg).toContain(`fill="${colour}"`);
    expect(svg).not.toMatch(/<script|class=|href=|url\(/);
  });
});
