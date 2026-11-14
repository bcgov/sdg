import { expect, type Page, test } from '@playwright/test';

import { mockFeatureFlagsAdmin, mockSession, type MockFlag } from './support/mock-console-api';

const FLAGS = '**/api/v1/shared/flags';
const HELLO_WORLD = '**/api/v1/shared/hello-world';

/** Fakes the evaluated flags console-api forwards from core-api. */
async function mockFlags(page: Page, flags: Record<string, true>): Promise<void> {
  await page.route(FLAGS, (route) => route.fulfill({ json: flags }));
}

/** The dashboard rendered in the shell, without hello-world or any error notice, and still on `/`. */
async function expectPlainDashboard(page: Page) {
  await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveText('Dashboard');
  await expect(page.getByRole('main')).toContainText('There is nothing on the dashboard yet.');
  await expect(page.getByText('Hello, world!')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
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

  test('leaves hello-world out, and never calls it, when the flag is off', async ({ page }) => {
    await mockSession(page, () => true);
    await mockFlags(page, {});
    let helloWorldCalls = 0;
    await page.route(HELLO_WORLD, (route) => {
      helloWorldCalls += 1;
      return route.fulfill({ status: 404, json: { statusCode: 404, message: 'Not Found' } });
    });
    const flagsResponse = page.waitForResponse(FLAGS);
    await page.goto('/');
    await flagsResponse;
    await expectPlainDashboard(page);
    expect(helloWorldCalls).toBe(0);
  });

  test('renders the dashboard without hello-world when the flags request fails (R7)', async ({ page }) => {
    await mockSession(page, () => true);
    await page.route(FLAGS, (route) => route.fulfill({ status: 503, json: { statusCode: 503 } }));
    const flagsResponse = page.waitForResponse(FLAGS);
    await page.goto('/');
    await flagsResponse;
    await expectPlainDashboard(page);
  });

  test('stays on the dashboard with nothing shown when hello-world answers 401 (no refusal redirect)', async ({
    page,
  }) => {
    await mockSession(page, () => true);
    await mockFlags(page, { hello_world: true });
    await page.route(HELLO_WORLD, (route) =>
      route.fulfill({ status: 401, json: { statusCode: 401, message: 'Unauthorized' } }),
    );
    const helloWorldResponse = page.waitForResponse(HELLO_WORLD);
    await page.goto('/');
    await helloWorldResponse;
    await expectPlainDashboard(page);
  });

  test('answers hello-world 404 with nothing shown', async ({ page }) => {
    await mockSession(page, () => true);
    await mockFlags(page, { hello_world: true });
    await page.route(HELLO_WORLD, (route) =>
      route.fulfill({ status: 404, json: { statusCode: 404, message: 'Not Found' } }),
    );
    const helloWorldResponse = page.waitForResponse(HELLO_WORLD);
    await page.goto('/');
    await helloWorldResponse;
    await expectPlainDashboard(page);
  });

  for (const path of ['/login', '/not-authorized']) {
    test(`makes no flags request on ${path} (R8)`, async ({ page }) => {
      await mockSession(page, () => false);
      const flagsRequests: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/v1/shared/flags') flagsRequests.push(request.url());
      });
      await page.goto(path);
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(flagsRequests).toEqual([]);
    });
  }
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
    const table = page.getByRole('table', { name: /Every feature flag/ });
    await expect(table.getByRole('row')).toHaveText([
      'KeyAudienceSwitchRolloutOverrides',
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
    // A press on the row's middle, away from the key, lands on the key's link, which covers the whole row.
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
    await expect(page.getByRole('list', { name: /Changes to hello_world/ }).getByRole('listitem')).toHaveCount(2);
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
    const history = page.getByRole('list', { name: 'Changes to old_flag, newest first' }).getByRole('listitem');
    await expect(history).toHaveCount(2);
    await expect(history.first()).toContainText('Deleted by Ada Lovelace. 1 override removed');
    await expect(page.getByRole('button', { name: /Save|Delete/ })).toHaveCount(0);
  });
});
