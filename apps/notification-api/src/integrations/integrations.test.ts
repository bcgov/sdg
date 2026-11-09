import { senderIntegrations } from '@repo/notification-database';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SecretCipher } from '../crypto/secret-cipher.js';
import { createTestApp, type TestApp } from '../testing/app.js';
import { integrationPath, SENDER_SMTP } from '../testing/integrations.js';
import { bearer, createSender } from '../testing/senders.js';
import { startTestIssuer, type TestIssuer } from '../testing/tokens.js';

let t: TestApp;
let issuer: TestIssuer;
let adminToken: string;

beforeAll(async () => {
  issuer = await startTestIssuer();
  t = await createTestApp({
    env: { ...issuer.env, NOTIFICATION_OUTBOUND_ALLOW_HOSTS: 'webhook-receiver' },
    issuerFetch: issuer.fetch,
  });
  adminToken = await issuer.ownClientUserToken({ admin: true });
});

afterAll(async () => {
  await t.close();
  await issuer.close();
});

const { password, ...nonSecretConfig } = SENDER_SMTP.config;

describe('saving an integration override', () => {
  it('rejects an smtp config without a host, and stores nothing', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'No host', owner: 'save-no-host' });
    const { host: _host, ...withoutHost } = SENDER_SMTP.config;

    const res = await t
      .http()
      .put(integrationPath(sender.id, 'email'))
      .set(bearer(sender.ownerToken))
      .send({ type: 'smtp', config: withoutHost });

    expect(res.status).toBe(400);
    const read = await t.http().get(integrationPath(sender.id, 'email')).set(bearer(sender.ownerToken));
    expect(read.status).toBe(404);
  });

  it("rejects a type that doesn't deliver the path's channel", async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Mismatch', owner: 'save-mismatch' });

    const res = await t
      .http()
      .put(integrationPath(sender.id, 'webhook'))
      .set(bearer(sender.ownerToken))
      .send(SENDER_SMTP);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('The smtp integration type does not deliver the webhook channel');
  });

  it('lets an admin save any sender’s override', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Admin', owner: 'save-admin' });

    const res = await t.http().put(integrationPath(sender.id, 'email')).set(bearer(adminToken)).send(SENDER_SMTP);

    expect(res.status).toBe(200);
  });
});

describe("a sender's integration secrets", () => {
  it('are never returned by a read, and are stored sealed for their row and field', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Secrets', owner: 'secrets-owner' });
    const owner = bearer(sender.ownerToken);

    const saved = await t.http().put(integrationPath(sender.id, 'email')).set(owner).send(SENDER_SMTP);
    const read = await t.http().get(integrationPath(sender.id, 'email')).set(owner);

    const expected = {
      channel: 'email',
      type: 'smtp',
      version: 1,
      config: nonSecretConfig,
      secretFieldsSet: ['password'],
    };
    expect(saved.body).toEqual({ id: saved.body.id, ...expected });
    expect(read.body).toEqual(saved.body);
    expect(JSON.stringify([saved.body, read.body])).not.toContain(password);
    const [row] = await t.database.db
      .select({ id: senderIntegrations.id, config: senderIntegrations.config })
      .from(senderIntegrations)
      .where(eq(senderIntegrations.senderId, sender.id));
    const sealed = String(row?.config['password']);
    expect(sealed).not.toContain(password);
    const cipher = t.app.get(SecretCipher);
    expect(cipher.decrypt(sealed, { rowId: row?.id ?? '', field: 'config.password' })).toBe(password);
  });
});

describe("another sender's integration override", () => {
  it('cannot be read, replaced or deleted by the owner of sender A', async () => {
    const [a, b] = await Promise.all([
      createSender(t, issuer, adminToken, { name: 'Own A', owner: 'cross-a' }),
      createSender(t, issuer, adminToken, { name: 'Own B', owner: 'cross-b' }),
    ]);
    await t.http().put(integrationPath(b.id, 'email')).set(bearer(b.ownerToken)).send(SENDER_SMTP);
    const asOwnerA = bearer(a.ownerToken);
    const onB = integrationPath(b.id, 'email');

    const attempts = await Promise.all([
      t.http().get(onB).set(asOwnerA),
      t
        .http()
        .put(onB)
        .set(asOwnerA)
        .send({ ...SENDER_SMTP, config: { ...SENDER_SMTP.config, host: 'evil.example.com' } }),
      t.http().delete(onB).set(asOwnerA),
    ]);

    expect(attempts.map((res) => res.status)).toEqual([403, 403, 403]);
    const read = await t.http().get(onB).set(bearer(b.ownerToken));
    expect(read.body).toMatchObject({ version: 1, config: { host: 'smtp.permits.example.com' } });
  });
});

describe('callback URL registration (R51)', () => {
  it('rejects http:// to a host that is not allow-listed, and accepts it to an allow-listed one', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Callbacks', owner: 'callback-owner' });
    const callback = (url: string) =>
      t.http().put(`/api/v1/senders/${sender.id}/callback`).set(bearer(sender.ownerToken)).send({ url });

    const rejected = await callback('http://hooks.example.com/failed');
    const accepted = await callback('http://webhook-receiver:8080/failed');

    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toBe('Must be an https:// URL');
    expect(accepted.status).toBe(200);
    expect(accepted.body.url).toBe('http://webhook-receiver:8080/failed');
  });
});
