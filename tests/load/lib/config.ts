// Shared settings for the k6 load scripts (DEVELOPER.md, Load tests). Pure data from __ENV, no k6 imports.

import type { Scenario } from 'k6/options';

/** Origin of the deployment under test, e.g. https://sdg-test.apps.gold.devops.gov.bc.ca (no path, no trailing slash). */
export function baseUrl(): string {
  const url = __ENV['BASE_URL'] ?? '';
  if (!/^https?:\/\/[A-Za-z0-9.-]+(:[0-9]+)?$/.test(url)) {
    throw new Error(
      `Invalid BASE_URL '${url}': expected an origin such as https://sdg-test.apps.gold.devops.gov.bc.ca`,
    );
  }
  return url;
}

interface Stage {
  duration: string;
  target: number;
}

const PROFILES: Readonly<Record<string, readonly Stage[]>> = Object.freeze({
  // Find the knee without just saturating TEST's 500m CPU quota
  ramp: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  // Quick local or CI sanity check
  smoke: [{ duration: '10s', target: 1 }],
});

/** Stages for LOAD_PROFILE (default ramp). */
export function stages(): Stage[] {
  const profile = __ENV['LOAD_PROFILE'] || 'ramp';
  const selected = PROFILES[profile];
  if (!selected) {
    throw new Error(`Invalid LOAD_PROFILE '${profile}': expected ${Object.keys(PROFILES).join(' or ')}`);
  }
  return [...selected];
}

const SCENARIOS: Readonly<Record<string, Scenario>> = Object.freeze({
  smoke: {
    executor: 'constant-vus',
    vus: 1,
    duration: '5s',
    options: {
      browser: { type: 'chromium' },
    },
  },
  ramp: {
    executor: 'ramping-vus',
    startVUs: 1,
    stages: [
      { duration: '30s', target: 5 }, // Ramp up to 5 browser VUs
      { duration: '1m', target: 5 }, // Hold at 5 browser VUs
      { duration: '20s', target: 0 }, // Ramp down to 0
    ],
    gracefulRampDown: '30s',
    options: {
      browser: { type: 'chromium' },
    },
  },
});

export function scenarios(): Record<string, Scenario> {
  const profile = __ENV['LOAD_PROFILE'] || 'smoke';
  const selected = SCENARIOS[profile];
  if (!selected) {
    throw new Error(`Invalid LOAD_PROFILE '${profile}': expected ${Object.keys(SCENARIOS).join(' or ')}`);
  }
  return { [profile]: selected };
}

/** Breaching any of these makes k6 exit non-zero, which fails the CI job. */
export const thresholds = Object.freeze({
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<500'],
  checks: ['rate>0.99'],
});
