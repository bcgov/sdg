import { Logger } from '@nestjs/common';
import { deriveSessionKey, PostgresSessionStore } from '@repo/bff-core';
import { SESSION_STORE } from '@repo/bff-core/nestjs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp, signIn, TEST_ENV, type SignedIn, type TestApp } from '../../src/testing/app.js';

/** The `console.sid=s%3A<sid>.<signature>` pair a sign-in set. */
function sessionCookie({ res }: SignedIn): { value: string; sid: string } {
  const value = res.headers['set-cookie']?.[0]?.split(';')[0]?.split('=')[1] ?? '';
  const sid = /^s:([^.]+)\./.exec(decodeURIComponent(value))?.[1];
  if (sid === undefined) throw new Error('no console.sid cookie');
  return { value, sid };
}

describe('console-api forwarding to core-api (R2, R4, R31, KTD3)', () => {
  let t: TestApp;
  let consoleUser: SignedIn;

  beforeAll(async () => {
    t = await createTestApp();
    consoleUser = await signIn(t);
  });

  afterAll(() => t.close());

  beforeEach(() => {
    t.coreApi.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Should forward a signed-in console call with the Bearer token and without the cookie', async () => {
    const res = await consoleUser.agent.get('/api/v1/console/service-clients');
    expect(res.status).toBe(200);
    expect(t.coreApi.received).toEqual([
      expect.objectContaining({ method: 'GET', url: '/api/v1/console/service-clients' }),
    ]);
    expect(t.coreApi.received[0]?.headers.authorization).toBe('Bearer access-token');
    expect(t.coreApi.received[0]?.headers.cookie).toBeUndefined();
  });

  it('Should forward shared routes too', async () => {
    expect((await consoleUser.agent.get('/api/v1/shared/me')).status).toBe(200);
    expect(t.coreApi.received.map(({ url }) => url)).toEqual(['/api/v1/shared/me']);
  });

  it('Should relay a same-origin registry change byte for byte', async () => {
    const body = '{"clientId":"reporting-service","displayName":"Reporting"}';
    const res = await consoleUser.agent
      .post('/api/v1/console/service-clients')
      .set('content-type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    expect(t.coreApi.received[0]).toMatchObject({ method: 'POST', body });
  });

  it.each(['/api/v1/portal/x', '/api/v1/gateway/me'])(
    'Should answer %s with 404 without contacting core-api (R4)',
    async (path) => {
      expect((await consoleUser.agent.get(path)).status).toBe(404);
      expect(t.coreApi.received).toEqual([]);
    },
  );

  it('Should refuse a registry change posted from another origin without contacting core-api (AE9)', async () => {
    const res = await consoleUser.agent
      .post('/api/v1/console/service-clients/reporting-service/disable')
      .set('origin', 'https://evil.example.com');
    expect(res.status).toBe(403);
    expect(t.coreApi.received).toEqual([]);
  });

  it('Should answer 401 to a signed-out console call without contacting core-api', async () => {
    expect((await t.http().get('/api/v1/console/service-clients')).status).toBe(401);
    expect(t.coreApi.received).toEqual([]);
  });

  describe('portal sessions (R7)', () => {
    it('Should treat a portal.sid cookie as signed out', async () => {
      const { value } = sessionCookie(consoleUser);
      const portal = t.http().set('cookie', `portal.sid=${value}`);
      expect((await portal.get('/api/auth/me')).status).toBe(401);
      expect((await portal.get('/api/v1/console/service-clients')).status).toBe(401);
      expect(t.coreApi.received).toEqual([]);
    });

    it('Should not read a session stored under portal-api’s key, even with the same secret', async () => {
      const own = await signIn(t);
      const { value, sid } = sessionCookie(own);
      expect((await t.http().set('cookie', `console.sid=${value}`).get('/api/auth/me')).status).toBe(200);
      const store: PostgresSessionStore = t.app.get(SESSION_STORE);
      const stored = await store.readSession(sid);
      if (stored === null) throw new Error(`no stored session ${sid}`);
      const portalStore = new PostgresSessionStore(t.database.db, {
        key: deriveSessionKey(TEST_ENV.SESSION_SECRET, 'portal-session-store'),
        ttlSeconds: 3600,
        logger: new Logger('PortalSessionStore'),
      });
      await new Promise<void>((resolve, reject) =>
        portalStore.set(sid, stored, (error) => (error ? reject(error) : resolve())),
      );
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      expect((await t.http().set('cookie', `console.sid=${value}`).get('/api/auth/me')).status).toBe(401);
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ msg: 'Discarding unreadable session' }));
    });
  });
});
