import { expect, type Page, test } from '@playwright/test';

// Runs the Feature Flags flow through the edge against a deployed console host with a real administrator
// (playwright.config.ts signs in first). Runs only when E2E_CONSOLE_USERNAME and E2E_CONSOLE_PASSWORD are set; skipped
// otherwise, as CI has none: run it by hand before merging a change to the flags pages or the edge's WAF.
test.skip(!process.env['E2E_CONSOLE_USERNAME'] || !process.env['E2E_CONSOLE_PASSWORD'], 'needs an admin test account');

const escapeRegExp = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const updates = (page: Page) => page.getByRole('status', { name: 'Feature flag updates' });

const overrideDialog = (page: Page) => page.getByRole('dialog', { name: 'Add or change an override' });

/** Opens the override dialog from the Overrides panel and searches for a person. */
async function search(page: Page, text: string) {
  await page
    .getByRole('region', { name: 'Overrides' })
    .getByRole('button', { name: 'Add or change an override' })
    .click();
  await overrideDialog(page)
    .getByRole('searchbox', { name: /Find a person/ })
    .fill(text);
}

/** The signed-in administrator's own display name, which the people search finds among console users. */
async function adminName(page: Page): Promise<string> {
  const response = await page.request.get('/api/auth/me');
  expect(response.ok()).toBe(true);
  const me: unknown = await response.json();
  const name: unknown = typeof me === 'object' && me !== null ? Reflect.get(me, 'name') : undefined;
  if (typeof name !== 'string' || name.length < 2) throw new Error('/api/auth/me returned no usable name');
  return name;
}

test('creates a console flag, overrides it for a person found by search, then deletes it', async ({ page }) => {
  const key = `e2e_${Date.now()}`;
  const name = await adminName(page);
  await page.goto('/feature-flags');
  await expect(page.getByRole('banner').getByRole('heading', { level: 1, name: 'Feature flags' })).toBeVisible();

  await page.getByRole('button', { name: 'Create feature flag' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a feature flag' });
  await dialog.getByRole('textbox', { name: /Key/ }).fill(key);
  // The radio inputs are visually hidden; choose one the way a keyboard user does.
  await dialog.getByRole('radio', { name: 'Console', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(dialog.getByRole('radio', { name: 'Console', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Create feature flag' }).click();
  await expect(updates(page)).toHaveText(`Created ${key}.`);

  // The list pages through the server: search for the new key, then open its row.
  const flags = page.getByRole('grid', { name: 'Feature flags' });
  await page.getByRole('searchbox', { name: 'Search' }).fill(key);
  await expect(page).toHaveURL(new RegExp(`/feature-flags\\?q=${key}$`));
  await flags
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: key, exact: true }) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/feature-flags/${key}\\?q=${key}$`));
  await page.getByRole('tab', { name: /^Overrides/ }).click();
  await search(page, name.slice(0, Math.max(2, Math.min(name.length, 5))));
  await overrideDialog(page)
    .getByRole('list', { name: 'People found' })
    .getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}`) })
    .first()
    .click();
  await overrideDialog(page)
    .getByRole('button', { name: `Turn on for ${name}` })
    .click();
  // A new flag starts off, so the override waits for the switch.
  await expect(updates(page)).toHaveText(`Saved ${name}’s “on” override. It applies once ${key} is turned on.`);
  await expect(overrideDialog(page)).toHaveCount(0);
  await expect(
    page
      .getByRole('grid', { name: `Overrides of ${key}` })
      .getByRole('row')
      .filter({ hasText: name }),
  ).toContainText('On');

  // Risks: the edge's WAF may refuse an apostrophe in the body. Either answer is handled; record which one came back.
  await search(page, "O'Brien");
  const noMatch = overrideDialog(page).getByText('No one matches that search.');
  const blocked = overrideDialog(page).getByRole('alert').filter({ hasText: 'The search was blocked' });
  await expect(noMatch.or(blocked)).toBeVisible();
  test.info().annotations.push({ type: 'waf', description: (await blocked.count()) > 0 ? 'blocked' : 'allowed' });
  await overrideDialog(page).getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: `Delete ${key}` }).click();
  await page
    .getByRole('alertdialog', { name: `Delete ${key}?` })
    .getByRole('button', { name: 'Delete' })
    .click();
  // Back to the search it was opened from, which now finds nothing.
  await expect(page).toHaveURL(new RegExp(`/feature-flags\\?q=${key}&deleted=${key}$`));
  await expect(updates(page)).toHaveText(`Deleted ${key}.`);
  await expect(flags.getByRole('rowheader', { name: key, exact: true })).toHaveCount(0);

  // History outlives the flag (AE7): newest first, the delete, the override and the create.
  await page.goto(`/feature-flags/${key}`);
  await expect(page.getByRole('main')).toContainText('This flag was deleted.');
  const history = page
    .getByRole('grid', { name: `Changes to ${key}, newest first` })
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader') });
  await expect(history).toHaveCount(3);
  await expect(history).toContainText(['Deleted', `Override set for ${name}`, 'Created']);
});
