import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp, type TestApp } from '../../src/testing/app.js';
import { json, unreachable } from '../../src/testing/core-api-stub.js';

const ME = '/api/v1/gateway/me';
const BEARER = 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJhenAiOiJwYXJ0bmVyLWNsaWVudCJ9.c2lnbmF0dXJl';

describe('gateway-api forwarding to core-api (R2, R4, R18, R19, KTD12)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(() => {
    t.coreApi.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Covers F4: a service account calls GET /api/v1/gateway/me', () => {
    it('Should forward the caller’s Authorization header unchanged and relay core-api’s answer', async () => {
      const res = await t.http().get(ME).set('authorization', BEARER).set('accept', 'application/json');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ clientId: 'partner-client', displayName: 'Partner', enabled: true });
      expect(t.coreApi.received).toEqual([expect.objectContaining({ method: 'GET', url: ME })]);
      expect(t.coreApi.received[0]?.headers.authorization).toBe(BEARER);
      expect(t.coreApi.received[0]?.headers.accept).toBe('application/json');
    });

    it('Should pass the query string through and never forward a Cookie or relay a Set-Cookie', async () => {
      const res = await t.http().get(`${ME}?verbose=1`).set('authorization', BEARER).set('cookie', 'portal.sid=x');
      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(t.coreApi.received[0]?.url).toBe(`${ME}?verbose=1`);
      expect(t.coreApi.received[0]?.headers.cookie).toBeUndefined();
    });

    it.each([
      [403, { statusCode: 403, message: 'This client is not registered or is disabled' }],
      [401, { statusCode: 401, message: 'Unauthorized' }],
    ])('Should relay core-api’s %i unchanged (R20)', async (status, body) => {
      t.coreApi.respond = json(status, body, { 'www-authenticate': 'Bearer error="invalid_token"' });
      const res = await t.http().get(ME).set('authorization', BEARER);
      expect(res.status).toBe(status);
      expect(res.body).toEqual(body);
      expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
      expect(t.coreApi.received).toHaveLength(1);
    });
  });

  describe('Covers AE5: only GET is forwarded (R19)', () => {
    it.each(['post', 'put', 'patch', 'delete', 'head', 'options'] as const)(
      'Should answer %s with 405 and Allow: GET without contacting core-api',
      async (method) => {
        const res = await t.http()[method](ME).set('authorization', BEARER);
        expect(res.status).toBe(405);
        expect(res.headers['allow']).toBe('GET');
        expect(t.coreApi.received).toEqual([]);
      },
    );
  });

  describe('a missing or non-Bearer Authorization (KTD12)', () => {
    it.each([
      ['no Authorization', undefined],
      ['a Basic one', 'Basic cGFydG5lcjpzZWNyZXQ='],
      ['an empty Bearer', 'Bearer '],
      ['a Bearer with two tokens', 'Bearer abc def'],
    ])('Should answer %s with 401 locally', async (_name, authorization) => {
      const request = t.http().get(ME);
      const res = await (authorization === undefined ? request : request.set('authorization', authorization));
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(t.coreApi.received).toEqual([]);
    });
  });

  describe('paths outside the gateway audience (R4)', () => {
    it.each([
      '/api/v1/portal/x',
      '/api/v1/admin/service-clients',
      '/api/v1/shared/me',
      '/internal/principals/login',
      '/api/auth/me',
      '/',
    ])('Should answer GET %s with 404 without contacting core-api', async (path) => {
      expect((await t.http().get(path).set('authorization', BEARER)).status).toBe(404);
      expect(t.coreApi.received).toEqual([]);
    });

    it.each([
      '/api/v1/gateway/..%5c..%5cinternal/principals/login',
      '/api/v1/gateway/%2e%2e/admin/service-clients',
      '/api/v1/gateway/me%2fx',
      '/api/v1/gateway//me',
    ])('Should answer the traversal %s with 404 without contacting core-api', async (path) => {
      expect((await t.http().get(path).set('authorization', BEARER)).status).toBe(404);
      expect(t.coreApi.received).toEqual([]);
    });

    it('Should answer 404, not 405, to a POST outside the gateway audience', async () => {
      expect((await t.http().post('/api/v1/portal/x').set('authorization', BEARER)).status).toBe(404);
      expect(t.coreApi.received).toEqual([]);
    });
  });

  describe('core-api unavailable (KTD3)', () => {
    it('Should answer 503 when core-api drops the connection, and log it', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      t.coreApi.respond = unreachable;
      const res = await t.http().get(ME).set('authorization', BEARER);
      expect(res.status).toBe(503);
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ msg: 'Forwarding GET to core-api failed' }));
    });
  });
});

describe('gateway-api with core-api down', () => {
  it('Should answer 503 when nothing listens at CORE_API_URL', async () => {
    const t = await createTestApp({ CORE_API_URL: 'http://127.0.0.1:1' });
    try {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      expect((await t.http().get(ME).set('authorization', BEARER)).status).toBe(503);
    } finally {
      vi.restoreAllMocks();
      await t.close();
    }
  });
});
