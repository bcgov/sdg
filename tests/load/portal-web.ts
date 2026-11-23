// portal-web through the edge: the SPA's index, then the JS/CSS it links (DEVELOPER.md, Load tests)
import { sleep } from 'k6';
import type { Options } from 'k6/options';

import { stages, thresholds } from './lib/config.ts';
import clientWebTest from './utils/client-web-test.ts';

export const options: Options = {
  stages: stages(),
  thresholds: { ...thresholds },
};

export default function (): void {
  const testHomePage = true;

  clientWebTest(testHomePage);
  sleep(1);
}
