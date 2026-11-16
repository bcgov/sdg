import { expect, type Page, test } from '@playwright/test';

import { mockFeatureFlagsAdmin, mockSession, type MockFlag } from './support/mock-console-api';

const FLAGS = '**/api/v1/shared/flags';
const HELLO_WORLD = '**/api/v1/shared/hello-world';

/** Fakes the evaluated flags console-api forwards from core-api. */
async function mockFlags(page: Page, flags: Record<string, true>): Promise<void> {
  await page.route(FLAGS, (route) => route.fulfill({ json: flags }));
}

// The flag provider and the dashboard's hello-world demo, with console-api answered in the browser.
test.describe('console-web feature flags', () => {
  test('shows "Hello, world!" on the dashboard when hello_world is on for the console user (AE9)', async ({ page }) => {
    await mockSession(page, () => true);
    await mockFlags(page, { hello_world: true });
    await page.route(HELLO_WORLD, (route) => route.fulfill({ json: { message: 'Hello, world!' } }));
    await page.goto('/');
    await expect(page.getByRole('main').getByText('Hello, world!')).toBeVisible();
  });
});

const ON_OVERRIDES: MockFlag['overrides'] = ['Ada', 'Bob', 'Cy'].map((name, i) => ({
  principalId: `00000000-0000-4000-8000-00000000000${i}`,
  name,
  email: null,
  kind: 'resident',
  enabled: true,
}));

const helloWorld = (fields: Partial<MockFlag> = {}): MockFlag => ({
  key: 'hello_world',
  description: 'The demo',
  enabled: true,
  rolloutPct: 50,
  audience: 'portal',
  overrideCounts: { on: 3, off: 0 },
  overrides: ON_OVERRIDES,
  ...fields,
});

const at = (minute: number) => `2026-11-10T17:0${minute}:00.000Z`;

/** No `<style>` beyond react-aria's hashed `@layer` ones: the edge CSP would block it. */
async function expectNoInlineStyles(page: Page) {
  const styles = await page.evaluate(() =>
    [...document.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .filter((text) => !text.trim().startsWith('@layer {')),
  );
  expect(styles).toEqual([]);
}

// The Feature Flags pages (R14–R21), with console-api's feature-flag routes answered in the browser.
test.describe('console-web Feature Flags pages', () => {
  test('lists the flags and creates one from the dialog, starting at 0% for the portal (R15, KTD12)', async ({
    page,
  }) => {
    const requests = await mockFeatureFlagsAdmin(page, [helloWorld()]);
    await page.goto('/feature-flags');
    await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveText('Feature flags');
    const table = page.getByRole('grid', { name: /Every feature flag/ });
    await expect(table.getByRole('row').filter({ has: page.getByRole('rowheader') })).toHaveText([
      'hello_worldPortalOn50%3 on, 0 off',
    ]);

    await page.getByRole('button', { name: 'Create feature flag' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create a feature flag' });
    await expect(dialog.getByRole('textbox', { name: /Rollout percentage/ })).toHaveValue('0');
    await expect(dialog.getByRole('radio', { name: 'Portal', exact: true })).toBeChecked();
    await expectNoInlineStyles(page);
    await dialog.getByRole('textbox', { name: /Key/ }).fill('Hello');
    await dialog.getByRole('button', { name: 'Create feature flag' }).click();
    await expect(dialog).toContainText('Use 2 to 63 lower-case letters');
    await dialog.getByRole('textbox', { name: /Key/ }).fill('new_search');
    await dialog.getByRole('button', { name: 'Create feature flag' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Feature flag updates' })).toHaveText('Created new_search.');
    await expect(table.getByRole('row').filter({ hasText: 'new_search' })).toContainText('Off0%');
    expect(requests.creates).toEqual([{ key: 'new_search', enabled: false, rolloutPct: 0, audience: 'portal' }]);
  });

  test('opens a flag from a press on its row, edits it inline with a PATCH of the change, and shows R21', async ({
    page,
  }) => {
    const requests = await mockFeatureFlagsAdmin(page, [helloWorld()]);
    await page.goto('/feature-flags');
    // The whole row is the link: a press on its middle, away from the key, opens the flag.
    await page.getByRole('row').filter({ hasText: 'hello_world' }).click();
    await expect(page).toHaveURL(/\/feature-flags\/hello_world$/);
    const details = page.getByRole('region', { name: 'Flag details' });
    await expect(details).toContainText('Keyhello_world');

    await details.getByRole('textbox', { name: /Rollout percentage/ }).fill('80');
    await details.getByRole('button', { name: 'Save changes' }).click();
    const updates = page.getByRole('status', { name: 'Feature flag updates' });
    await expect(updates).toHaveText('Saved hello_world.');

    // The switch's input is visually hidden; toggle it the way a keyboard user does.
    await details.getByRole('switch', { name: 'On' }).focus();
    await page.keyboard.press('Space');
    await expect(details.getByRole('switch', { name: 'On' })).not.toBeChecked();
    await details.getByRole('button', { name: 'Save changes' }).click();
    await expect(updates).toContainText('hello_world is off, but 3 people still get it');
    expect(requests.patches).toEqual([{ rolloutPct: 80 }, { enabled: false }]);
    await updates.getByRole('link', { name: 'Review the overrides' }).click();
    await expect(page.getByRole('region', { name: 'Overrides' })).toBeFocused();
    await expect(page.getByRole('grid', { name: /Changes to hello_world/ }).getByRole('rowheader')).toHaveCount(2);
  });

  test("shows a deleted flag's history and nothing to change (R19, AE7)", async ({ page }) => {
    const actor = { principalId: '0b6f8d0e-5c43-4a8e-9a43-2f1a3d9e7c11', name: 'Ada Lovelace' };
    await mockFeatureFlagsAdmin(
      page,
      [],
      [
        { id: 1, flagKey: 'old_flag', action: 'created', actor, subject: null, changes: {}, createdAt: at(1) },
        {
          id: 2,
          flagKey: 'old_flag',
          action: 'deleted',
          actor,
          subject: null,
          changes: { overridesRemoved: 1 },
          createdAt: at(2),
        },
      ],
    );
    await page.goto('/feature-flags/old_flag');
    await expect(page.getByRole('main')).toContainText('This flag was deleted.');
    const history = page
      .getByRole('grid', { name: 'Changes to old_flag, newest first' })
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader') });
    await expect(history).toHaveCount(2);
    await expect(history.first().getByRole('gridcell')).toHaveText(['Ada Lovelace', 'Deleted', '1 override removed']);
    await expect(page.getByRole('button', { name: /Save|Delete/ })).toHaveCount(0);
  });
});

const mockFlag = (key: string, fields: Partial<MockFlag> = {}): MockFlag => ({
  key,
  description: null,
  enabled: false,
  rolloutPct: 0,
  audience: 'portal',
  overrideCounts: { on: 0, off: 0 },
  overrides: [],
  ...fields,
});

/** The flags `manyFlags` gives the console: the console ones and `check_one`, for both apps. */
const CONSOLE_KEYS = [
  'check_one',
  ...[1, 4, 7, 10, 13, 16, 19, 22, 25].map((n) => `flag_${String(n).padStart(2, '0')}`),
];

/** 25 flags `flag_01`…`flag_25`, every third for the console, with `flag_07` the most forced on; and `check_one`. */
const manyFlags = (): MockFlag[] => [
  ...Array.from({ length: 25 }, (_, index) =>
    mockFlag(`flag_${String(index + 1).padStart(2, '0')}`, {
      audience: index % 3 === 0 ? 'console' : 'portal',
      overrideCounts: { on: index === 6 ? 9 : index % 4, off: 0 },
    }),
  ),
  mockFlag('check_one', { audience: 'both' }),
];

// The flag list and history as DataTables (R5–R8, R15–R20) against mocked pages of console-api's list conventions.
test.describe('console-web feature flag tables', () => {
  test('pages, searches, filters and sorts the flag list in the URL, and Enter opens a row (AE1, AE3, AE6)', async ({
    page,
  }) => {
    await mockFeatureFlagsAdmin(page, manyFlags());
    await page.goto('/feature-flags');
    const table = page.getByRole('grid', { name: /Every feature flag/ });
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    const keys = table.getByRole('rowheader');
    await expect(pager.getByText('Showing 1–20 of 26')).toBeVisible();
    await expect(pager.getByText('Page 1 of 2')).toBeVisible();

    await pager.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/\/feature-flags\?page=2$/);
    await expect(pager.getByText('Showing 21–26 of 26')).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search' }).fill('check');
    await expect(page).toHaveURL(/\/feature-flags\?q=check$/);
    await expect(keys).toHaveText(['check_one']);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(/\/feature-flags$/);

    await page.getByRole('button', { name: /Audience/ }).click();
    await expectNoInlineStyles(page);
    await page.getByRole('option', { name: 'Console' }).click();
    await expect(page).toHaveURL(/\/feature-flags\?audience=console$/);
    await expect(keys).toHaveText(CONSOLE_KEYS);

    await table.getByRole('columnheader', { name: /Overrides/ }).click();
    await expect(page).toHaveURL(/\?audience=console&sort=overridesOn&order=desc$/);
    await expect(table.getByRole('columnheader', { name: /Overrides/ })).toHaveAttribute('aria-sort', 'descending');
    await expect(keys.first()).toHaveText('flag_07');

    await table.getByRole('row').filter({ hasText: 'flag_07' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/feature-flags\/flag_07\?audience=console&sort=overridesOn&order=desc$/);
    await expect(page.getByRole('region', { name: 'Flag details' })).toContainText('Keyflag_07');
  });

  test('pages a flag history older and newer, from a reloaded URL, back to the newest (AE5)', async ({ page }) => {
    const actor = { principalId: '0b6f8d0e-5c43-4a8e-9a43-2f1a3d9e7c11', name: 'Ada Lovelace' };
    const events = Array.from({ length: 75 }, (_, index) => ({
      id: index + 1,
      flagKey: 'hello_world',
      action: 'updated',
      actor,
      subject: null,
      changes: { rollout_pct: { from: index, to: index + 1 } },
      createdAt: new Date(Date.parse('2026-11-10T17:00:00.000Z') + index * 60_000).toISOString(),
    }));
    await mockFeatureFlagsAdmin(page, [helloWorld()], events);
    await page.goto('/feature-flags/hello_world');
    const history = page.getByRole('grid', { name: 'Changes to hello_world, newest first' });
    const pager = page.getByRole('region', { name: 'History' }).getByRole('navigation', { name: 'Pagination' });
    const firstChange = history.getByRole('row').nth(1).getByRole('gridcell').last();
    await expect(firstChange).toHaveText('Rollout: 74% → 75%');

    await pager.getByRole('button', { name: 'Older' }).click();
    await expect(firstChange).toHaveText('Rollout: 54% → 55%');
    await pager.getByRole('button', { name: 'Older' }).click();
    await expect(page).toHaveURL(/\/feature-flags\/hello_world\?h\.before=36$/);
    await page.reload();
    await expect(firstChange).toHaveText('Rollout: 34% → 35%');

    await pager.getByRole('button', { name: 'Newer' }).click();
    await expect(firstChange).toHaveText('Rollout: 54% → 55%');
    await pager.getByRole('button', { name: 'Newer' }).click();
    await expect(firstChange).toHaveText('Rollout: 74% → 75%');
    await expect(page).toHaveURL(/\/feature-flags\/hello_world$/);
    await expect(pager.getByRole('button', { name: 'Newer' })).toBeDisabled();
    await expect(pager.getByRole('button', { name: 'Newest' })).toBeDisabled();
  });
});
