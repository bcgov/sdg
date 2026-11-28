import { expect, type Page } from '@playwright/test';
import { test } from '@repo/playwright-config';

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
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Access services online');
    await expect(page.getByRole('contentinfo')).toBeVisible();
  });

  // The not-found page is a title, an illustration and a few lines, so it stays shorter than the viewport (the home,
  // Help and Contact us pages run well past it).
  test('fills at least the viewport height with the footer at the bottom when content is short', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1600 });
    await page.goto('/does-not-exist');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Oops, looks like we’re lost');
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
        contentWidth: rect.width - paddingLeft - paddingRight,
        marginLeft: rect.left,
        marginRight: document.documentElement.clientWidth - rect.right,
      };
    });
    expect(m.maxWidth).toBe('1100px');
    expect(m.contentWidth).toBeCloseTo(1100, 0);
    expect(m.marginLeft).toBeGreaterThan(0);
    expect(m.marginLeft).toBeCloseTo(m.marginRight, 0);
  });

  test('pads the container only at the sides, so pages sit flush against the header and footer', async ({ page }) => {
    await page.goto('/services');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();

    const m = await page.evaluate(() => {
      const main = document.querySelector('main')!.getBoundingClientRect();
      const container = document.querySelector('main > div')!;
      const style = getComputedStyle(container);
      const rect = container.getBoundingClientRect();
      return {
        paddingTop: Number.parseFloat(style.paddingTop),
        paddingBottom: Number.parseFloat(style.paddingBottom),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        gapTop: container.firstElementChild!.getBoundingClientRect().top - main.top,
        gapBottom: rect.bottom - container.lastElementChild!.getBoundingClientRect().bottom,
      };
    });
    expect(m.paddingTop).toBe(0);
    expect(m.paddingBottom).toBe(0);
    expect(m.paddingLeft).toBeGreaterThan(0);
    expect(m.gapTop).toBeCloseTo(0, 0);
    expect(m.gapBottom).toBeCloseTo(0, 0);
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
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Oops, looks like we’re lost');
    await expect(main.getByText('Error 404 - Page not found')).toBeVisible();
    await expect(page.getByRole('banner')).toContainText('SDG');
    await expect(page.getByRole('contentinfo')).toBeVisible();

    await main.getByRole('link', { name: 'Home Page' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Access services online');
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

/** Viewport-relative geometry of the home page's hero, search control and placeholder grid. */
async function measureHome(page: Page) {
  return page.evaluate(() => {
    const heading = document.querySelector('main h1')!;
    const section = document.querySelector('main section[aria-labelledby]')!;
    const [header, hero, lede, search, sectionBox, ...placeholders] = [
      document.querySelector('sdg-header')!,
      heading.parentElement!.parentElement!,
      heading.nextElementSibling!,
      document.querySelector('main search')!,
      section,
      ...section.querySelectorAll('div[aria-hidden="true"] > div'),
    ].map((element) => {
      const { top, bottom, left, right, height } = element.getBoundingClientRect();
      return { top, bottom, left, right, height };
    });
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      container: (({ left, right }) => ({ left, right }))(
        document.querySelector('main > div')!.getBoundingClientRect(),
      ),
      containerPadding: Number.parseFloat(getComputedStyle(document.querySelector('main > div')!).paddingLeft),
      header: header!,
      hero: hero!,
      lede: lede!,
      search: search!,
      section: sectionBox!,
      placeholders,
    };
  });
}

test.describe('portal-web home page layout', () => {
  for (const width of [1280, 375]) {
    test(`runs the hero edge to edge, flush under the header, at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.getByRole('search')).toBeVisible();

      const m = await measureHome(page);
      expect(m.scrollWidth).toBe(m.clientWidth);
      expect(m.hero.left).toBeCloseTo(0, 0);
      expect(m.hero.right).toBeCloseTo(m.clientWidth, 0);
      expect(m.hero.top).toBeCloseTo(m.header.bottom, 0);
      expect(m.hero.height).toBeCloseTo(200, 0);
      // Half over the blue, half below it; the text above stays clear of it.
      expect((m.search.top + m.search.bottom) / 2).toBeCloseTo(m.hero.bottom, 0);
      expect(m.lede.bottom).toBeLessThanOrEqual(m.search.top);
      expect(m.section.top).toBeGreaterThanOrEqual(m.search.bottom);
      // The field and button span the content column.
      expect(m.search.left).toBeCloseTo(m.container.left + m.containerPadding, 0);
      expect(m.search.right).toBeCloseTo(m.container.right - m.containerPadding, 0);
    });
  }

  test('lays the placeholders out 3 × 2 on desktop, 2 × 3 at medium width and in one column on a phone', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Find a service' })).toBeVisible();
    let m = await measureHome(page);
    expect(m.placeholders).toHaveLength(6);
    expect(new Set(m.placeholders.map((p) => Math.round(p.top))).size).toBe(2);
    expect(new Set(m.placeholders.map((p) => Math.round(p.left))).size).toBe(3);

    await page.setViewportSize({ width: 900, height: 900 });
    m = await measureHome(page);
    expect(new Set(m.placeholders.map((p) => Math.round(p.top))).size).toBe(3);
    expect(new Set(m.placeholders.map((p) => Math.round(p.left))).size).toBe(2);

    await page.setViewportSize({ width: 375, height: 900 });
    m = await measureHome(page);
    expect(new Set(m.placeholders.map((p) => Math.round(p.left))).size).toBe(1);
  });

  test('shows View all services without an underline', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('region', { name: 'Find a service' }).getByRole('link', { name: 'View all services' });
    await expect(link).toHaveCSS('text-decoration-line', 'none');
    await link.hover();
    await expect(link).toHaveCSS('text-decoration-line', 'none');
  });

  test('searches from the hero and lands on /services with the query', async ({ page }) => {
    await page.goto('/');
    const search = page.getByRole('search');
    await search.getByRole('textbox', { name: 'Search for services' }).fill('dog licence');
    await search.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\/services\?q=dog(\+|%20)licence$/);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Services');
  });
});

test.describe('portal-web services search tools sheet', () => {
  // The sheet comes in from the right at medium widths and up from the bottom on phones; either way the top-left
  // corner is dimmed backdrop, and clicking it closes the sheet.
  for (const width of [900, 375]) {
    test(`closes when the dimmed area is clicked at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/services');
      await page.getByRole('button', { name: 'Search tools' }).click();
      const sheet = page.getByRole('dialog', { name: 'Search tools' });
      await expect(sheet).toBeVisible();

      await page.mouse.click(10, 10);
      await expect(sheet).toBeHidden();
    });
  }
});
