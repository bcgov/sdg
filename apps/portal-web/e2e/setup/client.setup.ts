import { expect } from '@playwright/test';
import { test as setup } from '@repo/playwright-config';

setup('authenticate', async ({ page, clientURL, clientUsername, clientPassword }) => {
  console.log('clientURL', clientURL);
  await page.goto(clientURL);

  const headerSection = page.locator('header');
  await headerSection.getByRole('link', { name: 'Sign in' }).click();

  await page.getByRole('button', { name: 'Test with username and password' }).click();

  // Perform login actions
  await page.getByRole('textbox', { name: 'Email or username' }).fill(clientUsername);
  await page.getByRole('textbox', { name: 'Password' }).fill(clientPassword);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Wait for login redirection or dashboard state to verify success
  await page.waitForURL(clientURL);
  await expect(page.getByText('Welcome to SDG')).toBeVisible();

  // Save cookies and localStorage to the JSON file
  await page.context().storageState({
    path: 'apps/portal-web/e2e/setup/client-auth.json',
  });
});
