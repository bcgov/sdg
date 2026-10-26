// portal-web through the edge: the SPA's index, then the JS/CSS it links (DEVELOPER.md, Load tests)
import { check, sleep } from 'k6';
import http from 'k6/http';
import type { Options } from 'k6/options';

import { baseUrl, stages, thresholds } from './lib/config.ts';

const BASE_URL = baseUrl();

export const options: Options = { stages: stages(), thresholds: { ...thresholds } };

/** /assets/... paths referenced by src= or href= in the index page. */
function assetPaths(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1] ?? '');
}

export default function (): void {
  const index = http.get(`${BASE_URL}/`, { tags: { name: 'index' } });
  const html = typeof index.body === 'string' ? index.body : '';
  check(index, {
    'index is 200': (r) => r.status === 200,
    'index is HTML': (r) => r.headers['Content-Type']?.startsWith('text/html') === true,
    'index has the app root': () => html.includes('<div id="root">'),
  });

  const assets = assetPaths(html);
  check(assets, { 'index links assets': (paths) => paths.length > 0 });
  const responses = http.batch(assets.map((path) => ['GET', `${BASE_URL}${path}`, null, { tags: { name: 'asset' } }]));
  check(responses, { 'assets are 200': (all) => all.every((r) => r.status === 200) });

  sleep(1);
}
