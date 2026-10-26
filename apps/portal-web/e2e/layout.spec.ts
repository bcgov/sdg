import { expect, type Page, test } from '@playwright/test';

/** Viewport-relative boxes of the layout regions, plus the document's scroll height. */
async function measureLayout(page: Page) {
  return page.evaluate(() => {
    // <sdg-header> is the header box; its <header> lives in the shadow root.
    const [layout, header, main, footer] = ['#root > div', 'sdg-header', 'main', 'footer'].map((selector) => {
      const { top, bottom, height } = document.querySelector(selector)!.getBoundingClientRect();
      return { top, bottom, height };
    });
    return {
      viewportHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      layout: layout!,
      header: header!,
      main: main!,
      footer: footer!,
    };
  });
}

test.describe('portal-web layout', () => {
  test('sets the document title and shows "SDG" in the header', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('SDG');
    await expect(page.getByRole('banner')).toContainText('SDG');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Welcome to SDG');
    await expect(page.getByRole('contentinfo')).toBeVisible();
  });

  test('does not let the header title be selected', async ({ page }) => {
    await page.goto('/');
    const title = page.getByRole('banner').getByText('SDG', { exact: true });
    await expect(title).toBeVisible();
    // Text selection reads the user-select (or WebKit-prefixed) computed value.
    const userSelect = await title.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.userSelect || style.getPropertyValue('-webkit-user-select');
    });
    expect(userSelect).toBe('none');

    // Double- and triple-clicking the title selects nothing.
    await title.dblclick();
    await title.click({ clickCount: 3 });
    expect(await page.evaluate(() => document.getSelection()?.toString() ?? '')).toBe('');
  });

  test('fills at least the viewport height with the footer at the bottom when content is short', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1600 });
    await page.goto('/');
    await expect(page.getByRole('contentinfo')).toBeVisible();

    const m = await measureLayout(page);
    expect(m.layout.height).toBeCloseTo(m.viewportHeight, 0);
    expect(m.scrollHeight).toBe(m.viewportHeight);
    expect(m.footer.bottom).toBeCloseTo(m.viewportHeight, 0);
    // <main> absorbs all the space the header and footer leave.
    expect(m.main.height).toBeCloseTo(m.viewportHeight - m.header.height - m.footer.height, 0);
  });

  test('grows past the viewport instead of clipping when content is taller than the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 480 });
    await page.goto('/');
    await expect(page.getByRole('contentinfo')).toBeVisible();

    const m = await measureLayout(page);
    expect(m.scrollHeight).toBeGreaterThan(m.viewportHeight);
    expect(m.layout.height).toBeCloseTo(m.scrollHeight, 0);
    expect(m.footer.top).toBeGreaterThanOrEqual(m.main.bottom - 1);
    expect(m.footer.bottom).toBeGreaterThan(m.viewportHeight);
  });

  test('centres the content container at a max width of 1100px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();

    const m = await page.evaluate(() => {
      const container = document.querySelector('main > div')!;
      const style = getComputedStyle(container);
      const rect = container.getBoundingClientRect();
      const paddingLeft = Number.parseFloat(style.paddingLeft);
      const paddingRight = Number.parseFloat(style.paddingRight);
      return {
        maxWidth: style.maxWidth,
        contentLeft: rect.left + paddingLeft,
        contentWidth: rect.width - paddingLeft - paddingRight,
        marginLeft: rect.left,
        marginRight: document.documentElement.clientWidth - rect.right,
        headerContentLeft: document
          .querySelector('sdg-header')!
          .shadowRoot!.querySelector('.bcds-header--container')!
          .getBoundingClientRect().left,
      };
    });
    expect(m.maxWidth).toBe('1100px');
    expect(m.contentWidth).toBeCloseTo(1100, 0);
    expect(m.marginLeft).toBeGreaterThan(0);
    expect(m.marginLeft).toBeCloseTo(m.marginRight, 0);
    expect(m.contentLeft).toBeCloseTo(m.headerContentLeft, 0);
  });

  test('spaces content from the container edges by the container padding alone', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();

    const m = await page.evaluate(() => {
      const container = document.querySelector('main > div')!;
      const style = getComputedStyle(container);
      const rect = container.getBoundingClientRect();
      return {
        paddingTop: Number.parseFloat(style.paddingTop),
        paddingBottom: Number.parseFloat(style.paddingBottom),
        gapTop: container.firstElementChild!.getBoundingClientRect().top - rect.top,
        gapBottom: rect.bottom - container.lastElementChild!.getBoundingClientRect().bottom,
      };
    });
    expect(m.paddingTop).toBeGreaterThan(0);
    expect(m.gapTop).toBeCloseTo(m.paddingTop, 0);
    expect(m.gapBottom).toBeCloseTo(m.paddingBottom, 0);
  });

  test('moves focus to main content via the skip link', async ({ page }) => {
    await page.goto('/');
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await skipLink.focus();
    await expect(skipLink).toBeInViewport();
    await skipLink.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    await expect(page).toHaveURL(/#main-content$/);
  });

  test('renders the not-found page inside the layout for an unknown path', async ({ page }) => {
    await page.goto('/does-not-exist');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    await expect(page.getByRole('banner')).toContainText('SDG');
    await expect(page.getByRole('contentinfo')).toBeVisible();

    await main.getByRole('link', { name: 'Go to the home page' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Welcome to SDG');
  });

  test('ships no devtools code in the production build', async ({ page }) => {
    const scripts: Promise<string>[] = [];
    page.on('response', (response) => {
      if (response.request().resourceType() === 'script') scripts.push(response.text());
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const bodies = await Promise.all(scripts);
    expect(bodies.length).toBeGreaterThan(0);
    // Devtools plugin names from src/components/devtools/panels.tsx survive minification.
    for (const body of bodies) {
      expect(body).not.toContain('TanStack Query');
      expect(body).not.toContain('TanStack Router');
    }
  });
});
