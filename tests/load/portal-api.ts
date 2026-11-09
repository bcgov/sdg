// portal-api through the edge, signed out (DEVELOPER.md, Load tests). Without a session cookie the request
// never reaches the session store: this measures the edge, WAF and Nest pipeline. Signed-in flows need a Keycloak test user.
import { check, sleep } from 'k6';
import http from 'k6/http';
import type { Options } from 'k6/options';

import { baseUrl, stages, thresholds } from './lib/config.ts';

const BASE_URL = baseUrl();

export const options: Options = { stages: stages(), thresholds: { ...thresholds } };

// 401 is the correct answer here, so it must not count towards http_req_failed
const signedOut = http.expectedStatuses(401);

export default function (): void {
  const me = http.get(`${BASE_URL}/api/auth/me`, { tags: { name: 'me' }, responseCallback: signedOut });
  check(me, {
    'me is 401 when signed out': (r) => r.status === 401,
    'me returns the 401 error body': (r) => {
      try {
        return r.json('statusCode') === 401;
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}
