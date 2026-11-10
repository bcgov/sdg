import { Logger } from '@nestjs/common';
import { startFakeIdp, type FakeIdp } from '@repo/auth/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessions } from '../session/sessions.schema.js';
import { createBffTestApp, setCookies, signIn, type BffTestApp, type SignedIn } from '../test-support/bff-app.js';
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

  it.each(['/api/v1/admin/service-clients', '/api/v1/gateway/me', '/api/v1/portal%2F..%2Fadmin/x'])(
    'answers 404 to %s without contacting core-api',
    async (path) => {
      expect((await user.agent.get(path)).status).toBe(404);
      expect(coreApi.received).toEqual([]);
    },
  );

  it('answers 401 to a signed-out call without contacting core-api', async () => {
    const res = await t.http().get('/api/v1/portal/things');
    expect(res.status).toBe(401);
    expect(coreApi.received).toEqual([]);
  });

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
