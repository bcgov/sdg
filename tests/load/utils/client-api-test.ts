import { group } from 'k6';

import ClientAuthAPIs from '../tests/client-api-auth.ts';
import { clientCookieData, setCookies } from './cookies.ts';
/**
 * This is the main entry point for the client API tests.
 */
export default function clientApiTest(options?: { testAuthHealth: boolean }) {
  setCookies(clientCookieData);

  if (options?.testAuthHealth) {
    group('Client API - Auth', () => {
      const clientAuth = new ClientAuthAPIs();
      // Login endpoint
      clientAuth.loginEndpoint();

      // Me endpoint
      clientAuth.meEndpoint();
    });
  }
}
