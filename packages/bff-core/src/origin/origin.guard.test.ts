import { startFakeIdp, type FakeIdp } from '@repo/auth/testing';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sessions } from '../session/sessions.schema.js';
import { APP_URL, createBffTestApp, signIn, type BffTestApp } from '../test-support/bff-app.js';
import { startCoreApiStub, type CoreApiStub } from '../test-support/core-api-stub.js';
import { createTestSessionDatabase, type TestSessionDatabase } from '../test-support/database.js';

const FORWARDED = '/api/v1/portal/things';

describe('OriginGuard (R31, AE9)', () => {
  let idp: FakeIdp;
  let coreApi: CoreApiStub;
  let database: TestSessionDatabase;
  let t: BffTestApp;

  beforeAll(async () => {
    [idp, coreApi, database] = await Promise.all([startFakeIdp(), startCoreApiStub(), createTestSessionDatabase()]);
    t = await createBffTestApp({ idp, coreApi, database });
  }, 60_000);

  afterAll(async () => {
    await t.close();
    await Promise.all([idp.close(), coreApi.close(), database.close()]);
  });

  beforeEach(async () => {
    await database.db.delete(sessions);
    coreApi.reset();
  });

  /** A client that sends no Origin unless told to. */
  const raw = () => supertest(t.app.getHttpServer());

  async function signedIn() {
    const { cookie } = await signIn(t, idp);
    coreApi.reset();
    return cookie;
  }

  it.each([
    ['a foreign Origin', 'https://evil.example'],
    ['a same-site but different origin', 'http://other.app.test'],
    ['an opaque Origin', 'null'],
  ])('refuses a signed-in POST with %s, without contacting core-api', async (_case, origin) => {
    const cookie = await signedIn();
    const res = await raw().post(FORWARDED).set('cookie', cookie).set('origin', origin).send({ name: 'x' });
    expect(res.status).toBe(403);
    expect(coreApi.received).toEqual([]);
  });

  it('refuses a POST without an Origin', async () => {
    const cookie = await signedIn();
    const res = await raw().post(FORWARDED).set('cookie', cookie).send({ name: 'x' });
    expect(res.status).toBe(403);
    expect(coreApi.received).toEqual([]);
  });

  it('covers the auth routes: a cross-origin logout leaves the session signed in', async () => {
    const cookie = await signedIn();
    const http = raw();
    expect(
      (await http.post('/api/auth/logout').set('cookie', cookie).set('origin', 'https://evil.example')).status,
    ).toBe(403);
    expect((await http.get('/api/auth/me').set('cookie', cookie)).status).toBe(200);
  });

  it.each(['put', 'patch', 'delete'] as const)('applies to %s', async (method) => {
    const cookie = await signedIn();
    const res = await raw()[method](FORWARDED).set('cookie', cookie).set('origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(coreApi.received).toEqual([]);
  });

  it('forwards a POST with the app own origin', async () => {
    const cookie = await signedIn();
    const res = await raw().post(FORWARDED).set('cookie', cookie).set('origin', APP_URL).send({ name: 'x' });
    expect(res.status).toBe(200);
    expect(coreApi.received).toEqual([expect.objectContaining({ method: 'POST', url: FORWARDED })]);
  });

  it('lets GET and HEAD through without an Origin', async () => {
    const cookie = await signedIn();
    const http = raw();
    expect((await http.get(FORWARDED).set('cookie', cookie)).status).toBe(200);
    expect((await http.head(FORWARDED).set('cookie', cookie)).status).toBe(200);
  });
});
