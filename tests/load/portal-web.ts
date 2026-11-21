// portal-web through the edge: the SPA's index, then the JS/CSS it links (DEVELOPER.md, Load tests)
import { sleep } from 'k6';
import type { Options } from 'k6/options';

import { scenarios, thresholds } from './lib/config.ts';
import clientWebTest from './utils/client-web-test.ts';

export const options: Options = {
  scenarios: scenarios(),
  thresholds: { ...thresholds },
};

export default async function (): Promise<void> {
  const testHomePage = true;

  await clientWebTest(testHomePage);
  sleep(1);
}
