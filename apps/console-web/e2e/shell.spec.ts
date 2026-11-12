import { expect, test } from '@playwright/test';

import { mockRegistry, mockSession } from './support/mock-console-api';

// The signed-in app shell with console-api answered in the browser: the sidebar, the command palette and the mobile
// navigation panel.
test.describe('console-web app shell', () => {
  test('keeps the sidebar collapsed to its icon rail after a reload (R12)', async ({ page }) => {
    await mockSession(page, () => true);
    await page.goto('/');
    const sidebar = page.locator('#app-sidebar');
    await expect(sidebar).toHaveAttribute('data-state', 'expanded');

    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');

    await page.reload();
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
    // The rail still offers every destination, by its accessible name.
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveCount(2);

    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(sidebar).toHaveAttribute('data-state', 'expanded');
  });

  test('goes to a destination from the command palette with ⌘K / Ctrl K (R8, R14)', async ({ page }) => {
    await mockRegistry(page);
    await page.goto('/');
    await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveText('Dashboard');

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Search' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('searchbox', { name: 'Search' })).toBeFocused();
    await expect(palette.getByRole('menuitem')).toHaveCount(4);

    await page.keyboard.type('serv');
    await expect(palette.getByRole('menuitem')).toHaveText(['Service Accounts']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(palette).toHaveCount(0);
    await expect(page).toHaveURL(/\/service-clients$/);
    await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveText('Service accounts');
  });

  test('navigates from the mobile panel at 390px, which then closes (R13)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockRegistry(page);
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Open navigation' }).click();
    const panel = page.getByRole('dialog', { name: 'Navigation' });
    await expect(panel).toBeVisible();
    await panel.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Service Accounts' }).click();

    await expect(page).toHaveURL(/\/service-clients$/);
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveText('Service accounts');
  });

  test('opens the palette only once the closing mobile panel has gone (KTD7)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockRegistry(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const panel = page.getByRole('dialog', { name: 'Navigation' });
    await expect(panel).toBeVisible();

    // Inside the panel's exit animation: it is closing but still in the page.
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+k');

    // At the moment the palette appears the panel must already be gone (no auto-wait): the two never share the page.
    // Role queries skip aria-hidden content, so finding the dialog also proves the panel did not hide it.
    const search = page.getByRole('dialog', { name: 'Search' });
    await search.waitFor();
    expect(await page.getByRole('dialog', { name: 'Navigation', includeHidden: true }).count()).toBe(0);
    await expect(search).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search' })).toBeFocused();
  });
});
