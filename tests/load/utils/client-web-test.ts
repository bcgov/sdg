import { browser } from 'k6/browser';

import ClientWebPages from '../tests/client-web-pages.ts';
import { clientCookieData } from './cookies.ts';

/**
 * This is the main entry point for the client web smoke tests.
 */
export default async function clientWebTest(testHomePage: boolean) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await context.addCookies(clientCookieData.cookies);

  const clientWebPages = new ClientWebPages();

  try {
    if (testHomePage) {
      clientWebPages.homePage();
    }
  } finally {
    await page.close();
    await context.close();
  }
}
