import { expect, type Page, test } from '@playwright/test';

import { admin, mockRegistry, mockSession } from './support/mock-console-api';

declare global {
  interface Window {
    /** CSP violations seen by the page, collected by an init script. */
    cspViolations?: string[];
  }
}

async function collectViolations(page: Page) {
  await page.addInitScript(() => {
    const violations: string[] = [];
    window.cspViolations = violations;
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.effectiveDirective} ${event.blockedURI} ${event.sample}`);
    });
  });
}

async function styleState(page: Page) {
  return page.evaluate(() => ({
    // Fixed react-aria styles (allowed by hash) are the only <style> elements the app may add.
    unhashedStyles: [...document.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .filter((text) => !text.trim().startsWith('@layer {')),
    adoptedSheets: document.adoptedStyleSheets.length,
    violations: window.cspViolations,
  }));
}

/** No `<style>` beyond react-aria's hashed ones, the design system's CSS adopted, and no CSP violation (R17). */
async function expectWithinCsp(page: Page) {
  const state = await styleState(page);
  expect(state.unhashedStyles).toEqual([]);
  expect(state.adoptedSheets).toBeGreaterThan(0);
  expect(state.violations).toEqual([]);
}

/** Opens an overlay, checks it, and closes it with Escape, which hands focus back to its trigger. */
async function openAndClose(page: Page, open: () => Promise<void>, overlay: ReturnType<Page['getByRole']>) {
  await open();
  await expect(overlay).toBeVisible();
  await expectWithinCsp(page);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
}

// The production build must work under the edge's strict CSP (no 'unsafe-inline' styles). Locally `pnpm preview`
// sends no CSP, so the violation check only bites against a deployed edge (CI's E2E_BASE_URL); the <style> and
// computed-style checks hold everywhere.
test.describe('console-web under the edge CSP', () => {
  test.beforeEach(async ({ page }) => collectViolations(page));

  test('styles the sign-in card with the design system', async ({ page }) => {
    await mockSession(page, () => false);
    await page.goto('/');
    const signIn = page.getByRole('main').getByRole('link', { name: 'Sign in' });
    await expect(signIn).toBeVisible();
    // bcgov's button look (the card's flex layout blockifies its display, so check a property it leaves alone).
    await expect(signIn).toHaveCSS('align-items', 'center');
    await expectWithinCsp(page);
  });

  test('styles the shell and its icons without inline <style> elements (KTD9)', async ({ page }) => {
    await mockSession(page, () => true);
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    const toggle = page.getByRole('button', { name: 'Collapse sidebar' });
    await expect(toggle).toHaveCSS('align-items', 'center');
    // FontAwesome's own stylesheet, imported instead of the <style> autoAddCss would inject.
    await expect(toggle.locator('svg')).toHaveCSS('overflow', 'visible');
    await expectWithinCsp(page);
  });

  test('opens the command palette without CSP violations', async ({ page }) => {
    await mockSession(page, () => true);
    await page.goto('/');
    const search = page.getByRole('button', { name: 'Search' });
    await openAndClose(page, () => search.click(), page.getByRole('dialog', { name: 'Search' }));
    await expect(search).toBeFocused();
  });

  test('opens the account menu without CSP violations', async ({ page }) => {
    await mockSession(page, () => true);
    await page.goto('/');
    const trigger = page.getByRole('button', { name: `Account menu for ${admin.name}` });
    await openAndClose(page, () => trigger.click(), page.getByRole('menu'));
    await expect(trigger).toBeFocused();
  });

  test('opens the mobile navigation panel without CSP violations', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSession(page, () => true);
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Open navigation' });
    await openAndClose(page, () => toggle.click(), page.getByRole('dialog', { name: 'Navigation' }));
    await expect(toggle).toBeFocused();
  });

  test('opens the remove dialog without CSP violations', async ({ page }) => {
    await mockRegistry(page);
    await page.goto('/service-clients');
    const remove = page.getByRole('button', { name: 'Remove billing-1' });
    await openAndClose(page, () => remove.click(), page.getByRole('alertdialog', { name: 'Remove billing-1?' }));
    await expect(remove).toBeFocused();
  });
});
