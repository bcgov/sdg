import { expect, type Locator, type Page } from '@playwright/test';

export const BREAKPOINTS = [
  { width: 375, height: 800 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];

export const NAV_LINKS = ['Home', 'Services', 'Help', 'Contact us'];

export const FOOTER_LINKS = [
  'Call, email or text us',
  'find a service centre',
  'Home',
  'About gov.bc.ca',
  'Disclaimer',
  'Privacy',
  'Accessibility',
  'Copyright',
  'Contact us',
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

  const navLinks = NAV_LINKS.map((link) => header.getByRole('link', { name: link }));

  const searchBoxControls = [...extraSearchBoxControls];

  const cardAccountControls = [...extraAccountControls];

  const moreServicesControls = [...extraMoreServicesControls];

  const contactControls = [...extraContactControls];

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

    const searchSideBarToggle = main.getByRole('button', { name: 'Hide sidebar' });
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
