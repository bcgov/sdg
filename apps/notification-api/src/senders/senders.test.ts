import { senders } from '@repo/notification-database';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SecretCipher } from '../crypto/secret-cipher.js';
import { createTestApp, type TestApp } from '../testing/app.js';
import { ensureTypes } from '../testing/catalog.js';
import { bearer, createSender } from '../testing/senders.js';
import { startTestIssuer, type TestIssuer } from '../testing/tokens.js';

let t: TestApp;
let issuer: TestIssuer;
let admin: { authorization: string };
let adminToken: string;

beforeAll(async () => {
  issuer = await startTestIssuer();
  t = await createTestApp({ env: issuer.env, issuerFetch: issuer.fetch });
  adminToken = await issuer.ownClientUserToken({ admin: true });
  admin = bearer(adminToken);
});

afterAll(async () => {
  await t.close();
  await issuer.close();
});

describe('admin sender endpoints', () => {
  it('create a sender, name an owner and grant types', async () => {
    const created = await t.http().post('/api/v1/admin/senders').set(admin).send({ name: 'Permits' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Permits',
      owners: [],
      grantedTypes: [],
      callbackUrl: null,
    });
    const id = String(created.body.id);

    await t
      .http()
      .post(`/api/v1/admin/senders/${id}/owners`)
      .set(admin)
      .send({ issuer: issuer.issuer, subject: 'jane' });
    await ensureTypes(t, adminToken, ['permit-issued', 'permit-expired']);
    await t.http().put(`/api/v1/admin/senders/${id}/grants/permit-issued`).set(admin);
    const granted = await t.http().put(`/api/v1/admin/senders/${id}/grants/permit-expired`).set(admin);

    expect(granted.status).toBe(200);
    expect(granted.body).toMatchObject({
      owners: [{ issuer: issuer.issuer, subject: 'jane' }],
      grantedTypes: ['permit-expired', 'permit-issued'],
    });
  });

  it('refuses to grant a type the catalog does not define', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Lands', owner: 'lands-owner' });
    const res = await t.http().put(`/api/v1/admin/senders/${sender.id}/grants/not-in-catalog`).set(admin);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('No Notification type with this key');
    expect((await t.http().get(`/api/v1/senders/${sender.id}`).set(admin)).body.grantedTypes).toEqual([]);
  });

  it('removing an owner ends their access to the sender', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Leases', owner: 'leaving-owner' });
    expect((await t.http().get(`/api/v1/senders/${sender.id}`).set(bearer(sender.ownerToken))).status).toBe(200);

    const removed = await t
      .http()
      .delete(`/api/v1/admin/senders/${sender.id}/owners`)
      .query({ issuer: issuer.issuer, subject: 'leaving-owner' })
      .set(admin);

    expect(removed.status).toBe(200);
    expect(removed.body.owners).toEqual([]);
    expect((await t.http().get(`/api/v1/senders/${sender.id}`).set(bearer(sender.ownerToken))).status).toBe(403);
  });

  it('are refused to a sender owner who is not an admin', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Water', owner: 'water-owner' });
    const res = await t
      .http()
      .put(`/api/v1/admin/senders/${sender.id}/grants/water-licence`)
      .set(bearer(sender.ownerToken));
    expect(res.status).toBe(403);
  });
});

describe('sender owner endpoints', () => {
  it('an owner of sender A can neither read nor change sender B', async () => {
    const [a, b] = await Promise.all([
      createSender(t, issuer, adminToken, { name: 'A', owner: 'owner-a', types: ['a-type'] }),
      createSender(t, issuer, adminToken, { name: 'B', owner: 'owner-b', types: ['b-type'] }),
    ]);
    const asOwnerA = bearer(a.ownerToken);

    const attempts = await Promise.all([
      t.http().get(`/api/v1/senders/${b.id}`).set(asOwnerA),
      t.http().put(`/api/v1/senders/${b.id}/callback`).set(asOwnerA).send({ url: 'https://a.example.com/hook' }),
      t.http().get(`/api/v1/senders/${b.id}/credentials`).set(asOwnerA),
      t.http().post(`/api/v1/senders/${b.id}/credentials`).set(asOwnerA).send({ clientId: 'a-sneaky-client' }),
    ]);

    expect(attempts.map((res) => res.status)).toEqual([403, 403, 403, 403]);
    const [senderB, credentialsB] = await Promise.all([
      t.http().get(`/api/v1/senders/${b.id}`).set(admin),
      t.http().get(`/api/v1/senders/${b.id}/credentials`).set(admin),
    ]);
    expect(senderB.body).toMatchObject({ callbackUrl: null, grantedTypes: ['b-type'] });
    expect(credentialsB.body).toEqual([]);
  });

  it('setting the callback URL returns a signing secret once and stores it encrypted', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Forests', owner: 'forests-owner' });
    const owner = bearer(sender.ownerToken);

    const set = await t
      .http()
      .put(`/api/v1/senders/${sender.id}/callback`)
      .set(owner)
      .send({ url: 'https://forests.example.com/failed' });

    expect(set.status).toBe(200);
    expect(set.body).toEqual({ url: 'https://forests.example.com/failed', secret: expect.stringMatching(/^whsec_/) });
    const secret = String(set.body.secret);
    // Standard Webhooks: whsec_ and base64 of 24–64 random bytes.
    expect(Buffer.from(secret.slice('whsec_'.length), 'base64')).toHaveLength(32);

    const read = await t.http().get(`/api/v1/senders/${sender.id}`).set(owner);
    expect(read.body).toEqual({
      id: sender.id,
      name: 'Forests',
      owners: [{ issuer: issuer.issuer, subject: 'forests-owner' }],
      grantedTypes: [],
      callbackUrl: 'https://forests.example.com/failed',
    });
    expect(read.text).not.toContain(secret.slice('whsec_'.length));

    const [row] = await t.database.db
      .select({ sealed: senders.callbackSecret })
      .from(senders)
      .where(eq(senders.id, sender.id));
    expect(row?.sealed).not.toContain(secret.slice('whsec_'.length));
    const cipher = t.app.get(SecretCipher);
    expect(cipher.decrypt(row?.sealed ?? '', { rowId: sender.id, field: 'callbackSecret' })).toBe(secret);
  });

  it('rejects a callback URL that is not https and keeps the current one', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Mines', owner: 'mines-owner' });
    const owner = bearer(sender.ownerToken);
    await t
      .http()
      .put(`/api/v1/senders/${sender.id}/callback`)
      .set(owner)
      .send({ url: 'https://mines.example.com/hook' });

    const rejected = await t
      .http()
      .put(`/api/v1/senders/${sender.id}/callback`)
      .set(owner)
      .send({ url: 'http://mines.example.com/hook' });

    expect(rejected.status).toBe(400);
    const read = await t.http().get(`/api/v1/senders/${sender.id}`).set(owner);
    expect(read.body.callbackUrl).toBe('https://mines.example.com/hook');
  });
});
