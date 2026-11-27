import { readFileSync } from 'node:fs';

import type { APIRequestContext, Page } from '@playwright/test';

export const LOADER_PATH = '/shared-ui/header/v1/loader.js';
export const LOADER_CONFIG_PATH = '/shared-ui/header/v1/loader.json';

/** The pre-load rule the package ships, which every embedding site copies (README, step 2). */
const PRELOAD_CSS = readFileSync(
  new URL('../../../../packages/shared-ui/src/header/preload.css', import.meta.url),
  'utf8',
);

/** A loader `<script>` tag's `src` (absolute) and `integrity`. */
export interface LoaderTag {
  src: string;
  integrity: string;
}

/** The environment's own loader tag, as the edge's loader.json gives it to in-repo apps. */
export async function environmentLoader(request: APIRequestContext, baseURL: string | undefined): Promise<LoaderTag> {
  const response = await request.get(new URL(LOADER_CONFIG_PATH, baseURL).href);
  if (!response.ok()) throw new Error(`${LOADER_CONFIG_PATH} answered ${response.status()}`);
  const config: { src: string; integrity: string } = await response.json();
  return { src: new URL(config.src, baseURL).href, integrity: config.integrity };
}

interface ExternalSiteOptions {
  page: Page;
  baseURL: string | undefined;
  /** The loader tag every page carries. Default: the environment's own loader (`environmentLoader`). */
  loader?: LoaderTag;
}

/**
 * Serves every page of a fake external site that embeds the header with the loader tag from the README (`integrity`,
 * `crossorigin`) and the pre-load rule, and returns the site's root URL. Each page has a Start link to the site's
 * root and a Next link to `/next`. `<html data-loader>` becomes `load` or `error` once the loader script settles.
 */
export async function serveExternalSite({ page, baseURL, loader }: ExternalSiteOptions): Promise<string> {
  const tag = loader ?? (await environmentLoader(page.request, baseURL));
  // A real external site is public HTTPS. Against the local dev server (http://localhost) the site is another
  // loopback origin instead, so it is still a secure context (the loader needs Web Crypto) and WebKit doesn't block the
  // http://localhost loader as mixed content. Chromium still treats a routed page as public, so it needs the Local
  // Network Access permission to reach localhost.
  const local = new URL(tag.src).protocol === 'http:';
  const external = local ? 'http://127.0.0.1:5199/' : 'https://external.example/';
  const externalOrigin = new URL(external).origin;
  if (local && page.context().browser()?.browserType().name() === 'chromium') {
    await page.context().grantPermissions(['local-network-access'], { origin: externalOrigin });
  }
  await page.route(
    (url) => url.origin === externalOrigin,
    (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html>
<html lang="en">
  <head>
    <title>External</title>
    <style>${PRELOAD_CSS}</style>
    <script>
      for (const type of ['load', 'error']) {
        document.addEventListener(type, (event) => {
          if (event.target.id === 'sdg-loader') document.documentElement.dataset.loader = type;
        }, true);
      }
    </script>
    <script id="sdg-loader" src="${tag.src}" integrity="${tag.integrity}" crossorigin="anonymous" async></script>
  </head>
  <body>
    <sdg-header site-title="External Service" login-href="/x"><a slot="nav" href="/">Start</a></sdg-header>
    <main><a href="/next">Next</a></main>
  </body>
</html>`,
      }),
  );
  return external;
}
