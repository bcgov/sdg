import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../../src/testing/app.js';
import { unreachable } from '../../src/testing/core-api-stub.js';

describe('gateway-api health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  afterEach(() => t.coreApi.reset());

  it('Should answer GET /healthz/live with 200 outside /api, without a token', async () => {
    const res = await t.http().get('/healthz/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', info: {}, error: {}, details: {} });
  });

  it('Should stay ready while core-api is down: an outage is a 503 per request, not a pod out of rotation', async () => {
    t.coreApi.respond = unreachable;
    const res = await t.http().get('/healthz/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', info: {}, error: {}, details: {} });
    expect(t.coreApi.received).toEqual([]);
  });
});
