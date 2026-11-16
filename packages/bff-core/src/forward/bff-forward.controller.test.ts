import { Logger } from '@nestjs/common';
import { AuthError, type OidcClient } from '@repo/auth';
import { startFakeIdp, type FakeIdp } from '@repo/auth/testing';
import { eq } from 'drizzle-orm';
import type supertest from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenRefreshService } from '../refresh/token-refresh.service.js';
import { sessions } from '../session/sessions.schema.js';
import {
  createBffTestApp,
  setCookies,
  setTokens,
  signIn,
  type BffTestApp,
  type SignedIn,
} from '../test-support/bff-app.js';
import { createTestSessionDatabase, type TestSessionDatabase } from '../test-support/database.js';
import { json, startCoreApiStub, unreachable, type CoreApiStub } from '../testing/core-api-stub.js';

describe('BffForwardController (KTD3)', () => {
  let idp: FakeIdp;
  let coreApi: CoreApiStub;
  let database: TestSessionDatabase;
  let t: BffTestApp;
  let user: SignedIn;

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
    user = await signIn(t, idp);
    coreApi.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards an own-audience call with the Bearer token and no cookie, and strips Set-Cookie', async () => {
    const res = await user.agent.get('/api/v1/portal/things?page=2').set('accept', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ forwarded: '/api/v1/portal/things?page=2' });
    expect(setCookies(res).some((cookie) => cookie.startsWith('core='))).toBe(false);
    const [received] = coreApi.received;
    expect(received?.headers).toMatchObject({ authorization: 'Bearer access-token', accept: 'application/json' });
    expect(received?.headers.cookie).toBeUndefined();
  });

  it('forwards the shared audience too', async () => {
    expect((await user.agent.get('/api/v2/shared/reference')).status).toBe(200);
    expect(coreApi.received.map(({ url }) => url)).toEqual(['/api/v2/shared/reference']);
  });

  it.each(['/api/v1/console/service-clients', '/api/v1/gateway/me', '/api/v1/portal%2F..%2Fconsole/x'])(
    'answers 404 to %s without contacting core-api',
    async (path) => {
      expect((await user.agent.get(path)).status).toBe(404);
      expect(coreApi.received).toEqual([]);
    },
  );

  it.each(['/api/v1/portal/things', '/api/v1/shared/flags'])(
    'answers 401 to a signed-out call to %s without contacting core-api, with no optional-session paths set',
    async (path) => {
      const res = await t.http().get(path);
      expect(res.status).toBe(401);
      expect(coreApi.received).toEqual([]);
    },
  );

  it('forwards JSON and form bodies byte for byte, and relays the status', async () => {
    coreApi.respond = json(201, { created: true });
    const raw = '{"name":"Ada","big":12345678901234567890}';
    const created = await user.agent.post('/api/v1/portal/things').set('content-type', 'application/json').send(raw);
    expect(created.status).toBe(201);
    await user.agent.put('/api/v1/portal/things/1').type('form').send('a=1&b=two');
    await user.agent.post('/api/v1/portal/notes').set('content-type', 'text/plain').send('plain text');
    expect(coreApi.received.map(({ method, body, headers }) => [method, body, headers['content-type']])).toEqual([
      ['POST', raw, 'application/json'],
      ['PUT', 'a=1&b=two', 'application/x-www-form-urlencoded'],
      ['POST', 'plain text', 'text/plain'],
    ]);
  });

  it('relays redirects and error statuses unchanged', async () => {
    coreApi.respond = (_req, res) => res.writeHead(302, { location: 'https://elsewhere.example/' }).end();
    const redirect = await user.agent.get('/api/v1/portal/moved');
    expect(redirect.status).toBe(302);
    expect(redirect.headers['location']).toBe('https://elsewhere.example/');
    coreApi.respond = json(409, { message: 'Conflict' });
    expect((await user.agent.post('/api/v1/portal/things').send({})).status).toBe(409);
  });

  it('answers 503 when core-api is unreachable, keeping the session', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    coreApi.respond = unreachable;
    expect((await user.agent.get('/api/v1/portal/things')).status).toBe(503);
    expect((await user.agent.get('/api/auth/me')).status).toBe(200);
  });

  it('ends the session and logs an error when core-api answers 401', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    coreApi.respond = json(401, { message: 'Unauthorized' });
    const res = await user.agent.get('/api/v1/portal/things');
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']?.[0]).toMatch(/^portal\.sid=;.*Expires=Thu, 01 Jan 1970/);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'core-api rejected the session access token; ending the session' }),
    );
    const [row] = await database.db.select().from(sessions).where(eq(sessions.sid, user.sid));
    expect(row?.destroyedAt).toBeInstanceOf(Date);
    expect((await user.agent.get('/api/auth/me')).status).toBe(401);
  });

  it('leaves other /api paths to the app, which answers 404', async () => {
    const res = await user.agent.get('/api/not-forwarded');
    expect(res.status).toBe(404);
    expect(coreApi.received).toEqual([]);
  });
});

const FLAGS = '/api/v1/shared/flags';
const HELLO_WORLD = '/api/v1/shared/hello-world';

/** True when the response clears the `portal.sid` cookie. */
const clearsCookie = (res: supertest.Response): boolean =>
  setCookies(res).some((cookie) => /^portal\.sid=;.*Expires=Thu, 01 Jan 1970/.test(cookie));

/** Holds `client.refresh` until released, then lets it reach the IdP. Resolves `started` when it is called. */
function gateRefresh(client: OidcClient) {
  const original = client.refresh.bind(client);
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  vi.spyOn(client, 'refresh').mockImplementationOnce(async (current) => {
    started.resolve();
    await gate.promise;
    return original(current);
  });
  return { started: started.promise, release: () => gate.resolve() };
}

describe('BffForwardController on optional-session paths (KTD2, R4, R5)', () => {
  let idp: FakeIdp;
  let coreApi: CoreApiStub;
  let database: TestSessionDatabase;
  let t: BffTestApp;

  const authorizations = () => coreApi.received.map(({ headers }) => headers.authorization);

  /** Signs in, then makes the access token expire in 10 seconds with `refreshToken`. */
  async function expiringSession(refreshToken: string = idp.issueRefreshToken()) {
    const signedIn = await signIn(t, idp);
    await setTokens(t, signedIn.sid, { expiresAt: Date.now() + 10_000, refreshToken });
    coreApi.reset();
    return signedIn;
  }

  beforeAll(async () => {
    [idp, coreApi, database] = await Promise.all([startFakeIdp(), startCoreApiStub(), createTestSessionDatabase()]);
    t = await createBffTestApp({ idp, coreApi, database, overrides: { optionalSessionPaths: [FLAGS, HELLO_WORLD] } });
  }, 60_000);

  afterAll(async () => {
    await t.close();
    await Promise.all([idp.close(), coreApi.close(), database.close()]);
  });

  beforeEach(async () => {
    await database.db.delete(sessions);
    coreApi.reset();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([FLAGS, HELLO_WORLD])(
    'forwards a signed-out GET to %s with no Authorization and relays the 200',
    async (path) => {
      coreApi.respond = json(200, { hello_world: true });
      const res = await t.http().get(path).set('authorization', 'Bearer browser-token');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hello_world: true });
      expect(coreApi.received.map(({ url }) => url)).toEqual([path]);
      expect(authorizations()).toEqual([undefined]);
    },
  );

  it("still forwards a valid session's Bearer token on a listed path", async () => {
    const { agent } = await signIn(t, idp);
    coreApi.reset();
    expect((await agent.get(FLAGS)).status).toBe(200);
    expect(authorizations()).toEqual(['Bearer access-token']);
  });

  it('clears the cookie and forwards anonymously when the refresh is rejected', async () => {
    const { agent, sid } = await expiringSession('revoked-refresh-token');
    const res = await agent.get(FLAGS);
    expect(res.status).toBe(200);
    expect(clearsCookie(res)).toBe(true);
    expect(authorizations()).toEqual([undefined]);
    const [row] = await database.db.select().from(sessions).where(eq(sessions.sid, sid));
    expect(row?.destroyedAt).toBeInstanceOf(Date);
  });

  it('forwards anonymously when the session is signed out while its refresh runs', async () => {
    const { agent } = await expiringSession();
    const held = gateRefresh(t.oidc);
    const pending = agent.get(FLAGS).then((res) => res);
    await held.started;
    expect((await agent.post('/api/auth/logout')).status).toBe(200);
    held.release();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(clearsCookie(res)).toBe(true);
    expect(authorizations()).toEqual([undefined]);
  });

  it('answers 503 without contacting core-api when the IdP is unreachable during the refresh (KTD15)', async () => {
    const { agent } = await expiringSession();
    vi.spyOn(t.oidc, 'refresh').mockRejectedValueOnce(
      new AuthError('refresh_failed', { cause: new TypeError('fetch failed') }),
    );
    expect((await agent.get(FLAGS)).status).toBe(503);
    expect(coreApi.received).toEqual([]);
  });

  it.each(['POST', 'HEAD'] as const)('answers 401 to a signed-out %s to a listed path', async (method) => {
    const http = t.http();
    const res = await (method === 'POST' ? http.post(FLAGS).send({}) : http.head(FLAGS));
    expect(res.status).toBe(401);
    expect(coreApi.received).toEqual([]);
  });

  it.each([
    ['an unlisted shared path', '/api/v1/shared/other', 401],
    ['a listed path under another audience', '/api/v1/portal/flags', 401],
    ['a longer path', `${FLAGS}/extra`, 401],
    ['a different case, which is not normalized', '/api/v1/shared/Flags', 401],
    ['a trailing slash', `${FLAGS}/`, 200],
    ['a percent-encoded letter', '/api/v1/shared/%66lags', 200],
    ['a query string', `${FLAGS}?audience=portal`, 200],
    ['an encoded dot segment', '/api/v1/shared/%2e%2e/shared/flags', 404],
    ['a raw dot segment', '/api/v1/shared/x/../flags', 404],
  ])('matches %s (%s) by its normalized path: signed out, %i', async (_case, path, status) => {
    expect((await t.http().get(path)).status).toBe(status);
    expect(authorizations()).toEqual(status === 200 ? [undefined] : []);
  });

  it('relays a core-api 401 on an anonymous forward without ending a session or logging the rejection', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const endSession = vi.spyOn(TokenRefreshService.prototype, 'endSession');
    coreApi.respond = json(401, { message: 'core-api says no' });
    const res = await t.http().get(FLAGS);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'core-api says no' });
    expect(clearsCookie(res)).toBe(false);
    expect(endSession).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
