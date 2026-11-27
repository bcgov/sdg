import { AxeBuilder } from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { test } from '@repo/playwright-config';

import { expectTabOrderAtBreakpoints } from './utils';

test.describe('Home Page Accessibility Testing', () => {
  test('Should have no axe violations on home page', async ({ page, clientURL }) => {
    await page.goto(clientURL);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Should have logical tab order and reach every control at each breakpoint on the home page', async ({
    page,
    clientURL,
    browserName,
  }) => {
    const main = page.getByRole('main');

    const searchToolsControls = [
      main.getByRole('textbox', { name: 'Search for services' }),
      main.getByRole('button', { name: 'Search' }),
      main.getByRole('link', { name: 'View all services' }),
    ];

    const accountControls = [
      main.getByRole('link', { name: 'Discover Services' }),
      main.getByRole('link', { name: 'Apply and track your requests' }),
      main.getByRole('link', { name: 'Manage your information' }),
      main.getByRole('link', { name: 'Log in with BC Services Card Account' }),
      main.getByRole('link', { name: 'Set up a BC Services Card Account' }),
    ];

    const moreServicesControls = [
      main.getByRole('link', { name: 'Learn more about Service BC' }),
      main.getByRole('link', { name: 'Book an appointment' }),
      main.getByRole('link', { name: 'Learn more about FrontCounter BC' }),
      main.getByRole('link', { name: 'Find Courthouse locations' }),
    ];

    const contactControls = [
      main.getByRole('link', { name: '1-888-356-2741' }),
      main.getByRole('link', { name: '604-660-2355' }).first(),
      main.getByRole('link', { name: '1-800-663-7867' }),
      main.getByRole('link', { name: '604-660-2355' }).nth(1),
      main.getByRole('link', { name: '711' }),
    ];

    await expectTabOrderAtBreakpoints(
      page,
      browserName,
      clientURL,
      searchToolsControls,
      accountControls,
      moreServicesControls,
      contactControls,
    );
  });
});
