import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';
import { PLATFORM_INTEGRATIONS, type PlatformIntegrations } from './platform-defaults.js';

/** `.env.example` ships every DEFAULT_SMTP_* key blank; copied to `.env` that must mean "no email default". */
const BLANK_SMTP_ENV = {
  DEFAULT_SMTP_HOST: '',
  DEFAULT_SMTP_PORT: '',
  DEFAULT_SMTP_SECURE: '',
  DEFAULT_SMTP_USER: '',
  DEFAULT_SMTP_PASSWORD: '',
  DEFAULT_SMTP_FROM: '',
};

describe('platform default integrations from a blank DEFAULT_SMTP_* environment', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ env: BLANK_SMTP_ENV });
  });

  afterAll(async () => {
    await t.close();
  });

  it('boots with no platform email integration and keeps the built-in webhook and in-app defaults', () => {
    const defaults = t.app.get<PlatformIntegrations>(PLATFORM_INTEGRATIONS);

    expect(defaults.email).toBeUndefined();
    expect(defaults.webhook).toMatchObject({ id: 'platform:webhook', type: 'webhook' });
    expect(defaults['in-app']).toMatchObject({ id: 'platform:in-app', type: 'in-app' });
  });
});
