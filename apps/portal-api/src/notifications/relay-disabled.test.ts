import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';

// Separate file: AppConfigModule reads the env once per module graph. TEST_ENV leaves NOTIFICATION_API_URL blank.
describe('notification relay with NOTIFICATION_API_URL blank', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  it('starts and returns 404 for the relay routes, signed in or not', async () => {
    const agent = t.http();
    await agent.get('/api/auth/login');
    await agent.get('/api/auth/callback').query({ code: 'code-1', state: 'state-1' });
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    expect((await agent.get('/api/v1/notifications/contact-points')).status).toBe(404);
    expect((await agent.get('/api/v1/notifications')).status).toBe(404);
    expect((await t.http().get('/api/v1/notifications/contact-points')).status).toBe(404);
    expect((await t.http().post('/api/v1/contact-points/confirm').send({ token: 'abc' })).status).toBe(404);
  });
});
