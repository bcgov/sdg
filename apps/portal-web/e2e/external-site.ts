import type { BrowserContext, Page } from '@playwright/test';

const HEADER_SCRIPT = '/shared-ui/header/v1/sdg-header.js';

interface ExternalSiteOptions {
  page: Page;
  context: BrowserContext;
  baseURL: string | undefined;
  browserName: string;
}

/**
 * Serves every page of a fake external site that loads the header from SDG (the dev server) with a plain script tag,
 * and returns the site's root URL. Each page has a Start link to the site's root and a Next link to `/next`.
 */
export async function serveExternalSite({ page, context, baseURL, browserName }: ExternalSiteOptions) {
  const scriptURL = new URL(HEADER_SCRIPT, baseURL).href;
  // The local dev server's http base URL needs two concessions a real external site (public, https) never meets:
  // Chromium lets only a granted secure origin reach localhost (Local Network Access), and WebKit treats an
  // http://localhost script on an https page as mixed content.
  const insecureBase = scriptURL.startsWith('http:');
  const external = insecureBase && browserName === 'webkit' ? 'http://external.example/' : 'https://external.example/';
  if (insecureBase && browserName === 'chromium') {
    await context.grantPermissions(['local-network-access'], { origin: external });
  }
  const externalOrigin = new URL(external).origin;
  await page.route(
    (url) => url.origin === externalOrigin,
    (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html>
<html lang="en">
  <head><title>External</title><script src="${scriptURL}"></script></head>
  <body>
    <sdg-header site-title="External Service" login-href="/x"><a slot="nav" href="/">Start</a></sdg-header>
    <main><a href="/next">Next</a></main>
  </body>
</html>`,
      }),
  );
  return external;
}
