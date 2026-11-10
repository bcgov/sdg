import * as path from 'node:path';

import { expect } from '@playwright/test';
import { test as setup } from '@repo/playwright-config';

// playwright.config.ts reads the same file for the signed-in specs.
const adminAuthFile = path.resolve(import.meta.dirname, '../../playwright/.auth/admin.json');

setup('sign in as an administrator', async ({ page, clientURL, clientUsername, clientPassword }) => {
  await page.goto(clientURL);
  await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click();

  await page.getByRole('button', { name: 'Test with username and password' }).click();
  await page.getByRole('textbox', { name: 'Email or username' }).fill(clientUsername);
  await page.getByRole('textbox', { name: 'Password' }).fill(clientPassword);
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.waitForURL((url) => url.origin === new URL(clientURL).origin && url.pathname === '/');
  await expect(page.getByRole('banner').getByRole('button', { name: /^Account menu for / })).toBeVisible();
  await page.context().storageState({ path: adminAuthFile });
});
