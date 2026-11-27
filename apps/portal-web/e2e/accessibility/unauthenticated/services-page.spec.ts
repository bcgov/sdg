import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { test } from '@repo/playwright-config';

import { BREAKPOINTS, FOOTER_LINKS, NAV_LINKS } from './utils';

async function expectNavigationAtBreakpoints(page: Page, browserName: string, url: string) {
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  const down = browserName === 'webkit' ? 'Alt+ArrowDown' : 'ArrowDown';
  const main = page.getByRole('main');
  const header = page.locator('sdg-header');
  const footer = page.getByRole('contentinfo');

  const navLinks = NAV_LINKS.map((link) => header.getByRole('link', { name: link }));

  const searchToolsControls = [
    page.getByRole('button', { name: 'Close search tools' }),
    page.getByRole('radio', { name: 'All' }),
    page.getByRole('button', { name: 'Clear all' }),
    page.getByRole('button', { name: 'Show results' }),
  ];

  const searchBoxControls = [
    main.getByRole('textbox', { name: 'Search for services' }),
    main.getByRole('button', { name: 'Search', exact: true }),
  ];

  const paginationControls = [
    main.getByRole('button', { name: '1' }),
    main.getByRole('button', { name: '2' }),
    main.getByRole('button', { name: '3' }),
    main.getByRole('button', { name: 'Next page' }),
    main.getByRole('link', { name: 'Find ways to contact us' }),
  ];
  const footerLinks = FOOTER_LINKS.map((link) => footer.getByRole('link', { name: link }));

  const tabThrough = (locators: Locator[]) =>
    locators.reduce(async (chain, locator) => {
      await chain;
      await page.keyboard.press(tab);
      await expect(locator).toBeFocused();
    }, Promise.resolve());

  await BREAKPOINTS.reduce(async (chain, viewport) => {
    await chain;
    await page.setViewportSize(viewport);
    await page.goto(url);
    await expect(header.getByRole('link', { name: 'Log In' })).toBeVisible();

    await tabThrough([
      page.getByRole('link', { name: 'Skip to main content' }),
      header.getByRole('link', { name: 'Set up' }),
      header.getByRole('link', { name: 'Log In' }),
      page.locator('[data-part="lockup"]'),
    ]);

    const menuToggle = header.getByRole('button', { name: 'Menu' });
    if (await menuToggle.isVisible()) {
      await tabThrough([menuToggle]);
      await page.keyboard.press('Enter');
      await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
      await tabThrough(navLinks);
      await page.keyboard.press('Escape');
      await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
    } else {
      await tabThrough(navLinks);
    }

    const searchSideBarToggle = main.getByRole('button', { name: 'Hide sidebar' });
    if (await searchSideBarToggle.isVisible()) {
      await tabThrough([searchSideBarToggle, page.getByRole('radio', { name: 'All' })]);
      await page.keyboard.press(down);
      await expect(page.getByRole('radio', { name: 'Service' })).toBeFocused();
      await page.keyboard.press(down);
      await expect(page.getByRole('radio', { name: 'Platform' })).toBeFocused();
    }

    await tabThrough(searchBoxControls);

    const searchToolsToggle = main.getByRole('button', { name: 'Search tools' });
    if (await searchToolsToggle.isVisible()) {
      await tabThrough([searchToolsToggle]);
      await page.keyboard.press('Enter');
      await tabThrough(searchToolsControls);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Search tools' })).toHaveCount(0);
      await expect(searchToolsToggle).toBeFocused();
    }

    await tabThrough(paginationControls);

    await tabThrough(footerLinks);
  }, Promise.resolve());
}

test.describe('Services Page Accessibility Testing', () => {
  test('Should have no axe violations on services page', async ({ page, clientURL }) => {
    await page.goto(`${clientURL}/#services`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Should have logical tab order and reach every control at each breakpoint on the services page when search button is not clicked', async ({
    page,
    clientURL,
    browserName,
  }) => {
    await expectNavigationAtBreakpoints(page, browserName, `${clientURL}/services`);
  });
});
