import { AxeBuilder } from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { test } from '@repo/playwright-config';

import { expectTabOrderAtBreakpoints } from './utils';

test.describe('Help Page Accessibility Testing', () => {
  test('Should have no axe violations on help page', async ({ page, clientURL }) => {
    await page.goto(`${clientURL}/help`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Should have logical tab order and reach every control at each breakpoint on the help page', async ({
    page,
    clientURL,
    browserName,
  }) => {
    await expectTabOrderAtBreakpoints(page, browserName, `${clientURL}/help`);
  });
});
