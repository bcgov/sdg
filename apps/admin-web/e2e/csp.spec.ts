import { expect, type Page, test } from '@playwright/test';

import { mockRegistry } from './support/mock-admin-api';

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

// The production build must work under the edge's strict CSP (no 'unsafe-inline' styles). Locally `pnpm preview`
// sends no CSP, so the violation check only bites against a deployed edge (CI's E2E_BASE_URL); the <style> and
// computed-style checks hold everywhere.
test.describe('admin-web under the edge CSP', () => {
  test('styles the design system without inline <style> elements or CSP violations', async ({ page }) => {
    await collectViolations(page);
    await page.goto('/');
    await expect(page.getByRole('contentinfo')).toBeVisible();
    await expect(page.locator('.bcds-footer')).toHaveCSS('display', 'flex');

    const state = await styleState(page);
    expect(state.unhashedStyles).toEqual([]);
    expect(state.adoptedSheets).toBeGreaterThan(0);
    expect(state.violations).toEqual([]);
  });

  test('opens the remove dialog without CSP violations', async ({ page }) => {
    await collectViolations(page);
    await mockRegistry(page);
    await page.goto('/service-clients');
    await page.getByRole('button', { name: 'Remove billing-1' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Remove billing-1?' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove billing-1' })).toBeFocused();

    const state = await styleState(page);
    expect(state.unhashedStyles).toEqual([]);
    expect(state.violations).toEqual([]);
  });
});
