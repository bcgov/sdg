import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, signIn, type TestApp } from '../testing/app.js';

const OPTIONAL_SESSION_PATHS = ['/api/v1/shared/flags', '/api/v1/shared/hello-world'];

describe('portal-api forwarding without a session (KTD2, R4, R5)', () => {
  let t: TestApp;
  const authorizations = () => t.coreApi.received.map(({ headers }) => headers.authorization);

  beforeAll(async () => {
    t = await createTestApp();
  }, 60_000);

  afterAll(() => t.close());

  beforeEach(() => {
    t.coreApi.reset();
  });

  it.each(OPTIONAL_SESSION_PATHS)(
    'Should forward a signed-out GET to %s to core-api with no Authorization and relay its answer',
    async (path) => {
      const res = await t.http().get(path);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ forwarded: path });
      expect(authorizations()).toEqual([undefined]);
    },
  );

  it.each(['/api/v1/portal/things', '/api/v1/shared/other'])(
    'Should answer 401 to a signed-out GET to %s without contacting core-api',
    async (path) => {
      expect((await t.http().get(path)).status).toBe(401);
      expect(t.coreApi.received).toEqual([]);
    },
  );

  it('Should answer 401 to a signed-out POST to /api/v1/shared/flags without contacting core-api', async () => {
    expect((await t.http().post('/api/v1/shared/flags').send({})).status).toBe(401);
    expect(t.coreApi.received).toEqual([]);
  });

  it("Should forward a signed-in resident's Bearer token on /api/v1/shared/flags", async () => {
    const { agent } = await signIn(t);
    t.coreApi.reset();
    expect((await agent.get('/api/v1/shared/flags')).status).toBe(200);
    expect(authorizations()).toEqual([expect.stringMatching(/^Bearer /)]);
  });
});
