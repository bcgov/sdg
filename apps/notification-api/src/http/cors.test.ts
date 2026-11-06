import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';

const ALLOWED = 'https://app.example.com';
const UNLISTED = 'https://other.example.com';
const RECIPIENT_PATHS = ['/api/v1/me/inbox', '/api/v1/me/inbox/stream'];

/** Every `access-control-*` header on a response. */
function corsHeaders(res: Response): Record<string, string> {
  const headers = res.headers as Record<string, string>;
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.startsWith('access-control-')));
}

function preflight(t: TestApp, path: string, origin: string, method = 'GET') {
  return t
    .http()
    .options(path)
    .set('origin', origin)
    .set('access-control-request-method', method)
    .set('access-control-request-headers', 'authorization,sdg-background');
}

describe('CORS for direct mode', () => {
  describe('with CORS_ALLOWED_ORIGINS set', () => {
    let t: TestApp;

    beforeAll(async () => {
      t = await createTestApp({ env: { CORS_ALLOWED_ORIGINS: `${ALLOWED},http://localhost:5173` } });
    });

    afterAll(() => t.close());

    it('answers a preflight to the recipient endpoints from an allowed origin', async () => {
      const responses = await Promise.all(RECIPIENT_PATHS.map((path) => preflight(t, path, ALLOWED, 'POST')));
      for (const res of responses) {
        expect(res.status).toBe(204);
        expect(corsHeaders(res)).toEqual({
          'access-control-allow-origin': ALLOWED,
          'access-control-allow-methods': 'GET,POST',
          'access-control-allow-headers': 'authorization,content-type,sdg-background',
          'access-control-max-age': '600',
        });
      }
    });

    it('lets an allowed origin read a recipient response, and never allows credentials', async () => {
      const res = await t.http().get('/api/v1/me/inbox').set('origin', ALLOWED);
      expect(res.status).toBe(401);
      expect(corsHeaders(res)).toEqual({ 'access-control-allow-origin': ALLOWED });
      expect(res.headers.vary).toMatch(/\borigin\b/i);
    });

    it('gives an unlisted origin no access-control-allow-origin', async () => {
      const res = await preflight(t, '/api/v1/me/inbox', UNLISTED);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      const get = await t.http().get('/api/v1/me/inbox').set('origin', UNLISTED);
      expect(get.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('gives paths outside /api/v1/me/ no CORS headers, even from an allowed origin', async () => {
      const paths = ['/api/v1/admin/topics', '/api/v1/notifications', '/healthz/live'];
      const responses = await Promise.all(
        paths.flatMap((path) => [preflight(t, path, ALLOWED), t.http().get(path).set('origin', ALLOWED)]),
      );
      for (const res of responses) expect(corsHeaders(res)).toEqual({});
    });
  });

  describe('with CORS_ALLOWED_ORIGINS empty', () => {
    let t: TestApp;

    beforeAll(async () => {
      t = await createTestApp({ env: { CORS_ALLOWED_ORIGINS: '' } });
    });

    afterAll(() => t.close());

    it('puts no CORS headers on any response', async () => {
      expect(corsHeaders(await preflight(t, '/api/v1/me/inbox', ALLOWED))).toEqual({});
      expect(corsHeaders(await t.http().get('/api/v1/me/inbox').set('origin', ALLOWED))).toEqual({});
      expect(corsHeaders(await t.http().get('/healthz/live').set('origin', ALLOWED))).toEqual({});
    });
  });
});
