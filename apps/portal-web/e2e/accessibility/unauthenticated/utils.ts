import { expect, type Locator, type Page } from '@playwright/test';

export const BREAKPOINTS = [
  { width: 375, height: 800 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];

export async function expectTabOrderAtBreakpoints(
  page: Page,
  browserName: string,
  url: string,
  extraSearchBoxControls: Locator[] = [],
  extraAccountControls: Locator[] = [],
  extraMoreServicesControls: Locator[] = [],
  extraContactControls: Locator[] = [],
) {
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  const main = page.getByRole('main');
  const header = page.locator('sdg-header');
  const footer = page.getByRole('contentinfo');

  const navLinks = [
    header.getByRole('link', { name: 'Home' }),
    header.getByRole('link', { name: 'Services' }),
    header.getByRole('link', { name: 'Help' }),
    header.getByRole('link', { name: 'Contact us' }),
  ];

  const searchToolsControls = [
    page.getByRole('button', { name: 'Close search tools' }),
    page.getByRole('radio', { name: 'All' }),
    page.getByRole('button', { name: 'Clear all' }),
    page.getByRole('button', { name: 'Show results' }),
  ];

  const searchBoxControls = [...extraSearchBoxControls];

  const cardAccountControls = [...extraAccountControls];

  const moreServicesControls = [...extraMoreServicesControls];

  const contactControls = [...extraContactControls];

  const footerLinks = [
    footer.getByRole('link', { name: 'Call, email or text us' }),
    footer.getByRole('link', { name: 'find a service centre' }),
    footer.getByRole('link', { name: 'Home' }),
    footer.getByRole('link', { name: 'About gov.bc.ca' }),
    footer.getByRole('link', { name: 'Disclaimer' }),
    footer.getByRole('link', { name: 'Privacy' }),
    footer.getByRole('link', { name: 'Accessibility' }),
    footer.getByRole('link', { name: 'Copyright' }),
    footer.getByRole('link', { name: 'Contact us' }),
  ];

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
      header.getByRole('link', { name: 'Log In' }),
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

    const searchToolsToggle = main.getByRole('button', { name: 'Search tools' });
    if (await searchToolsToggle.isVisible()) {
      await tabThrough([searchToolsToggle]);
      await page.keyboard.press('Enter');
      await tabThrough(searchToolsControls);
      await page.keyboard.press('Escape');
    }

    const searchSideBarToggle = main.getByRole('button', { name: 'Close sidebar' });
    if (await searchSideBarToggle.isVisible()) {
      await tabThrough([searchSideBarToggle, page.getByRole('radio', { name: 'All' })]);
    }

    await tabThrough(searchBoxControls);

    await tabThrough(cardAccountControls);

    await tabThrough(moreServicesControls);

    await tabThrough(contactControls);

    await tabThrough(footerLinks);
  }, Promise.resolve());
}
