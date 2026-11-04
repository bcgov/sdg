import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SecretCipher } from '../crypto/secret-cipher.js';
import { createTestApp, type TestApp } from '../testing/app.js';
import { integrationPath, PLATFORM_SMTP_ENV, SENDER_SMTP } from '../testing/integrations.js';
import { bearer, createSender, type SenderFixture } from '../testing/senders.js';
import { startTestIssuer, type TestIssuer } from '../testing/tokens.js';
import { platformIntegrations } from './platform-defaults.js';
import { IntegrationResolver } from './resolver.service.js';

let t: TestApp;
let issuer: TestIssuer;
let adminToken: string;
let resolver: IntegrationResolver;

beforeAll(async () => {
  issuer = await startTestIssuer();
  t = await createTestApp({ env: { ...issuer.env, ...PLATFORM_SMTP_ENV }, issuerFetch: issuer.fetch });
  adminToken = await issuer.ownClientUserToken({ admin: true });
  resolver = t.app.get(IntegrationResolver);
});

afterAll(async () => {
  await t.close();
  await issuer.close();
});

const platformEmail = {
  id: 'platform:email',
  source: 'platform',
  channel: 'email',
  type: 'smtp',
  config: {
    host: 'smtp.platform.example.com',
    port: 587,
    secure: false,
    user: 'platform',
    password: 'platform-test-password',
    from: 'notify@platform.example.com',
  },
};

async function putSmtp(sender: SenderFixture, config: Record<string, unknown> = SENDER_SMTP.config) {
  const res = await t
    .http()
    .put(integrationPath(sender.id, 'email'))
    .set(bearer(sender.ownerToken))
    .send({ type: 'smtp', config });
  expect(res.status).toBe(200);
  return String(res.body.id);
}

describe('F4: a sender brings its own email integration', () => {
  it("uses the sender's smtp override for that sender only; others keep the platform default", async () => {
    const [a, b] = await Promise.all([
      createSender(t, issuer, adminToken, { name: 'Permits', owner: 'f4-permits' }),
      createSender(t, issuer, adminToken, { name: 'Parks', owner: 'f4-parks' }),
    ]);

    const id = await putSmtp(a);

    await expect(resolver.resolve(a.id, 'email')).resolves.toEqual({
      id,
      version: '1',
      source: 'sender',
      channel: 'email',
      type: 'smtp',
      config: SENDER_SMTP.config,
    });
    await expect(resolver.resolve(b.id, 'email')).resolves.toMatchObject(platformEmail);
  });

  it('resolves each attempt afresh: a replaced override has a new version, a deleted one falls back', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Mines', owner: 'f4-mines' });
    const id = await putSmtp(sender);
    const first = await resolver.resolve(sender.id, 'email');

    await putSmtp(sender, { ...SENDER_SMTP.config, host: 'smtp2.permits.example.com' });
    const second = await resolver.resolve(sender.id, 'email');
    const removed = await t.http().delete(integrationPath(sender.id, 'email')).set(bearer(sender.ownerToken));
    const third = await resolver.resolve(sender.id, 'email');

    expect(first).toMatchObject({ id, version: '1' });
    expect(second).toMatchObject({ id, version: '2', config: { host: 'smtp2.permits.example.com' } });
    expect(removed.status).toBe(204);
    expect(third).toMatchObject(platformEmail);
  });
});

describe('platform defaults', () => {
  it('webhook and in-app use their built-in types with no configuration', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Roads', owner: 'defaults-roads' });

    const [webhook, inApp] = await Promise.all([
      resolver.resolve(sender.id, 'webhook'),
      resolver.resolve(sender.id, 'in-app'),
    ]);

    expect(webhook).toEqual({
      id: 'platform:webhook',
      version: '1',
      source: 'platform',
      channel: 'webhook',
      type: 'webhook',
      config: {},
    });
    expect(inApp).toMatchObject({ id: 'platform:in-app', source: 'platform', type: 'in-app' });
  });

  it('resolves no email integration when there is no platform default and no override', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Fish', owner: 'defaults-fish' });
    const withoutDefault = new IntegrationResolver(t.database.db, t.app.get(SecretCipher), platformIntegrations({}));

    await expect(withoutDefault.resolve(sender.id, 'email')).resolves.toBeNull();
  });

  it('rejects an incomplete DEFAULT_SMTP_* configuration, naming the variable but not the password', () => {
    const { DEFAULT_SMTP_FROM: _from, ...withoutFrom } = PLATFORM_SMTP_ENV;
    const env = { ...withoutFrom, DEFAULT_SMTP_PORT: 587, DEFAULT_SMTP_SECURE: false };

    expect(() => platformIntegrations(env)).toThrow(/DEFAULT_SMTP_FROM/);
    expect(() => platformIntegrations(env)).not.toThrow(/platform-test-password/);
  });
});
