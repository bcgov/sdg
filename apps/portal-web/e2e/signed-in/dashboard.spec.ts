import { expect } from '@playwright/test';
import { test } from '@repo/playwright-config';

test.describe('Client Dashboard E2E Test Suite', () => {
  test.beforeEach(async ({ page, clientURL }) => {
    await page.goto(clientURL);
  });

  test('Should display greeting content after successful login', async ({ page }) => {
    await expect(page.getByText('Access services online')).toBeVisible();
  });
});
