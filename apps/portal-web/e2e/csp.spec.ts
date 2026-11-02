import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    /** CSP violations seen by the page, collected by an init script. */
    cspViolations?: string[];
  }
}

// The production build must work under the edge's strict CSP (no 'unsafe-inline' styles). Locally `pnpm preview`
// sends no CSP, so the violation check only bites against a deployed edge (CI's E2E_BASE_URL); the <style> and
// computed-style checks hold everywhere.
test.describe('portal-web under the edge CSP', () => {
  test('styles the design system without inline <style> elements or CSP violations', async ({ page }) => {
    await page.addInitScript(() => {
      const violations: string[] = [];
      window.cspViolations = violations;
      document.addEventListener('securitypolicyviolation', (event) => {
        violations.push(`${event.effectiveDirective} ${event.blockedURI} ${event.sample}`);
      });
    });
    await page.goto('/');
    await expect(page.getByRole('contentinfo')).toBeVisible();

    // The bcgov footer's own CSS turns it into a flex column; a <footer> is display: block without it.
    await expect(page.locator('.bcds-footer')).toHaveCSS('display', 'flex');

    const state = await page.evaluate(() => ({
      // Fixed react-aria styles (allowed by hash) are the only <style> elements the app may add.
      unhashedStyles: [...document.querySelectorAll('style')]
        .map((style) => style.textContent ?? '')
        .filter((text) => !text.trim().startsWith('@layer {')),
      adoptedSheets: document.adoptedStyleSheets.length,
      violations: window.cspViolations,
    }));
    expect(state.unhashedStyles).toEqual([]);
    expect(state.adoptedSheets).toBeGreaterThan(0);
    expect(state.violations).toEqual([]);
  });
});
