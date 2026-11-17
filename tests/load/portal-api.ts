// portal-api through the edge, signed out (DEVELOPER.md, Load tests). Without a session cookie the request
// never reaches Valkey: this measures the edge, WAF and Nest pipeline. Signed-in flows need a Keycloak test user.
import { sleep } from 'k6';
import type { Options } from 'k6/options';

import { stages, thresholds } from './lib/config.ts';
import clientApiTest from './utils/client-api-test.ts';

export const options: Options = {
  stages: stages(),
  thresholds: { ...thresholds },
};

export default function (): void {
  const testOptions = { testAuthHealth: true };

  clientApiTest(testOptions);

  sleep(1);
}
