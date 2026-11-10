import { expect, type Page, test } from '@playwright/test';

// Covers F3 against a deployed admin host with a real administrator (playwright.config.ts signs in first). Runs only
// when E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD are set; skipped otherwise.
test.skip(!process.env['E2E_ADMIN_USERNAME'] || !process.env['E2E_ADMIN_PASSWORD'], 'needs an admin test account');

function row(page: Page, clientId: string) {
  return page.getByRole('table', { name: /Clients the gateway accepts/ }).getByRole('row', { name: clientId });
}

async function expectUpdate(page: Page, text: string) {
  await expect(page.getByRole('status', { name: 'Registry updates' })).toHaveText(text);
}

test('adds, disables, re-enables and removes a service account, and records each change', async ({ page }) => {
  const clientId = `e2e-${Date.now()}`;
  await page.goto('/service-clients');
  await expect(page.getByRole('heading', { level: 1, name: 'Service accounts' })).toBeVisible();

  await page.getByRole('textbox', { name: /Client ID/ }).fill(clientId);
  await page.getByRole('textbox', { name: /Display name/ }).fill('Playwright e2e');
  await page.getByRole('button', { name: 'Add service account' }).click();
  await expectUpdate(page, `Added ${clientId}.`);
  await expect(row(page, clientId)).toContainText('Enabled');

  await page.getByRole('button', { name: `Disable ${clientId}` }).click();
  await expectUpdate(page, `Disabled ${clientId}.`);
  await expect(row(page, clientId)).toContainText('Disabled');

  await page.getByRole('button', { name: `Enable ${clientId}` }).click();
  await expectUpdate(page, `Enabled ${clientId}.`);
  await expect(row(page, clientId)).toContainText('Enabled');

  await page.getByRole('button', { name: `Remove ${clientId}` }).click();
  await page
    .getByRole('alertdialog', { name: `Remove ${clientId}?` })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expectUpdate(page, `Removed ${clientId}.`);
  await expect(row(page, clientId)).toHaveCount(0);

  // History outlives the entry (R17): newest first, all four changes by this administrator.
  const history = page
    .getByRole('table', { name: /Every change to the registry/ })
    .getByRole('row', { name: clientId });
  await expect(history).toHaveCount(4);
  await expect(history).toContainText(['Removed', 'Enabled', 'Disabled', 'Added']);
});
