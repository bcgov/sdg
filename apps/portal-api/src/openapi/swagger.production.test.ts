import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';

// Separate file: AppConfigModule reads the env once per module graph, and Vitest isolates each test file.
describe('OpenAPI (production)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ env: { NODE_ENV: 'production' } });
  });

  afterAll(() => t.close());

  it('does not serve Swagger UI or the OpenAPI document', async () => {
    expect((await t.http().get('/api/docs')).status).toBe(404);
    expect((await t.http().get('/api/docs/')).status).toBe(404);
    expect((await t.http().get('/api/docs-json')).status).toBe(404);
  });

  it('still serves the API and metrics', async () => {
    expect((await t.http().get('/api/auth/me')).status).toBe(401);
    expect((await t.http().get('/metrics')).status).toBe(200);
  });
});
