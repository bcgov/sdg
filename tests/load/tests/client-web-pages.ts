import { check } from 'k6';
import http from 'k6/http';

import { baseUrl } from '../lib/config.ts';

const BASE_URL = baseUrl();

/** /assets/... paths referenced by src= or href= in the index page. */
function assetPaths(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1] ?? '');
}

export default class ClientWebPages {
  /**
   * Utility function for client home page that checks if the page loads
   * successfully, returns a 200 status code, and contains expected text.
   */
  homePage = () => {
    const index = http.get(`${BASE_URL}/`, {
      tags: { name: 'index' },
    });
    const html = typeof index.body === 'string' ? index.body : '';
    check(index, {
      'index is 200': (r) => r.status === 200,
      'index is HTML': (r) => r.headers['Content-Type']?.startsWith('text/html') === true,
      'index has the app root': () => html.includes('<div id="root">'),
    });

    const assets = assetPaths(html);
    check(assets, { 'index links assets': (paths) => paths.length > 0 });
    const responses = http.batch(
      assets.map((path) => ['GET', `${BASE_URL}${path}`, null, { tags: { name: 'asset' } }]),
    );
    check(responses, {
      'assets are 200': (all) => all.every((r) => r.status === 200),
    });
  };
}
