import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, signIn, type SignedIn, type TestApp } from '../../src/testing/app.js';

describe('portal-api forwarding to core-api (R2, R4, KTD3)', () => {
  let t: TestApp;
  let resident: SignedIn;

  beforeAll(async () => {
    t = await createTestApp();
    resident = await signIn(t);
  });

  afterAll(() => t.close());

  beforeEach(() => {
    t.coreApi.reset();
  });

  it('Should forward a signed-in portal call with the Bearer token and without the cookie', async () => {
    const res = await resident.agent.get('/api/v1/portal/x?page=2').set('accept', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ forwarded: '/api/v1/portal/x?page=2' });
    expect(t.coreApi.received).toHaveLength(1);
    const [received] = t.coreApi.received;
    expect(received).toMatchObject({ method: 'GET', url: '/api/v1/portal/x?page=2' });
    expect(received?.headers.authorization).toBe('Bearer access-token');
    expect(received?.headers.cookie).toBeUndefined();
    // core-api's own Set-Cookie never reaches the browser; only the rolling portal.sid does.
    const cookies: unknown = res.headers['set-cookie'];
    expect(cookies).toEqual([expect.stringMatching(/^portal\.sid=/)]);
  });

  it('Should forward shared routes too', async () => {
    const res = await resident.agent.get('/api/v1/shared/me');
    expect(res.status).toBe(200);
    expect(t.coreApi.received.map(({ url }) => url)).toEqual(['/api/v1/shared/me']);
  });

  it.each(['/api/v1/admin/anything', '/api/v1/gateway/clients/me'])(
    'Should answer %s with 404 without contacting core-api (AE2)',
    async (path) => {
      const res = await resident.agent.get(path);
      expect(res.status).toBe(404);
      expect(t.coreApi.received).toEqual([]);
    },
  );

  it('Should never forward core-api’s /internal routes', async () => {
    expect((await resident.agent.post('/api/internal/principals/login')).status).toBe(404);
    expect((await resident.agent.post('/internal/principals/login')).status).toBe(404);
    expect(t.coreApi.received).toEqual([]);
  });

  it('Should answer 401 to a signed-out portal call without contacting core-api', async () => {
    const res = await t.http().get('/api/v1/portal/x');
    expect(res.status).toBe(401);
    expect(t.coreApi.received).toEqual([]);
  });

  it('Should refuse a cross-origin POST without contacting core-api (R31)', async () => {
    const res = await resident.agent.post('/api/v1/portal/x').set('origin', 'https://evil.example.com').send({ a: 1 });
    expect(res.status).toBe(403);
    expect(t.coreApi.received).toEqual([]);
  });

  it('Should relay a same-origin JSON body byte for byte (rawBody)', async () => {
    const body = '{"name":"Ada","big":12345678901234567890}';
    const res = await resident.agent.post('/api/v1/portal/x').set('content-type', 'application/json').send(body);
    expect(res.status).toBe(200);
    expect(t.coreApi.received[0]?.body).toBe(body);
  });
});
