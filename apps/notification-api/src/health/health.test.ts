import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createIssuerFetch,
  createTestApp,
  ISSUER_DISCOVERY_URL,
  ISSUER_JWKS_URL,
  requestUrl,
  type TestApp,
} from '../testing/app.js';

function requestedUrls(t: TestApp): string[] {
  return t.issuerFetch.mock.calls.map(([input]) => requestUrl(input));
}

describe('health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(() => {
    t.issuerFetch.mockReset().mockImplementation(createIssuerFetch());
  });

  describe('GET /healthz/live', () => {
    it('returns 200 status ok without touching dependencies', async () => {
      const res = await t.http().get('/healthz/live');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', info: {}, error: {}, details: {} });
      expect(t.issuerFetch).not.toHaveBeenCalled();
    });
  });

  describe('GET /healthz/ready', () => {
    it('returns 200 with the issuer up after reading its discovery document and the JWKS it names', async () => {
      const res = await t.http().get('/healthz/ready');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', info: { issuer: { status: 'up' } } });
      expect(requestedUrls(t)).toEqual([ISSUER_DISCOVERY_URL, ISSUER_JWKS_URL]);
    });

    it('returns 503 with the issuer down when its discovery document is unreachable', async () => {
      t.issuerFetch.mockRejectedValue(new TypeError('fetch failed'));
      const res = await t.http().get('/healthz/ready');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ status: 'error', error: { issuer: { status: 'down' } } });
    });

    it('returns 503 when the JWKS endpoint fails or holds no keys', async () => {
      const issuer = createIssuerFetch();
      t.issuerFetch.mockImplementation((input, init) =>
        requestUrl(input) === ISSUER_JWKS_URL
          ? Promise.resolve(new Response('', { status: 502 }))
          : issuer(input, init),
      );
      expect((await t.http().get('/healthz/ready')).status).toBe(503);

      t.issuerFetch.mockImplementation((input, init) =>
        requestUrl(input) === ISSUER_JWKS_URL ? Promise.resolve(Response.json({ keys: [] })) : issuer(input, init),
      );
      const res = await t.http().get('/healthz/ready');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ error: { issuer: { status: 'down' } } });
    });
  });
});
