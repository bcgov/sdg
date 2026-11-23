import ClientWebPages from '../tests/client-web-pages.ts';
import { clientCookieData, setCookies } from './cookies.ts';

/**
 * This is the main entry point for the client web smoke tests.
 */
export default function clientWebTest(testHomePage: boolean) {
  setCookies(clientCookieData);

  const clientWebPages = new ClientWebPages();

  if (testHomePage) {
    clientWebPages.homePage();
  }
}
