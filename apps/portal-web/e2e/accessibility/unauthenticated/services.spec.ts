import { AxeBuilder } from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { test } from '@repo/playwright-config';

import { expectTabOrderAtBreakpoints } from './utils';

test.describe('Services Page Accessibility Testing', () => {
  test('Should have no axe violations on services page', async ({ page, clientURL }) => {
    await page.goto(`${clientURL}/#services`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Should have logical tab order and reach every control at each breakpoint on the services page', async ({
    page,
    clientURL,
    browserName,
  }) => {
    const main = page.getByRole('main');

    const searchBoxControls = [
      main.getByRole('textbox', { name: 'Search for services' }),
      main.getByRole('button', { name: 'Search', exact: true }),
      main.getByRole('button', { name: '1' }),
      main.getByRole('button', { name: '2' }),
      main.getByRole('button', { name: '3' }),
      main.getByRole('button', { name: 'Next page' }),
      main.getByRole('link', { name: 'Find ways to contact us' }),
    ];
    await expectTabOrderAtBreakpoints(page, browserName, `${clientURL}/services`, searchBoxControls);
  });
});
