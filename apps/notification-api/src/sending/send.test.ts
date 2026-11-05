import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { contactPoints, credentials, recipientRegistrations, recipients } from '../database/schema/index.js';
import { createTestApp, type TestApp } from '../testing/app.js';
import { bearer } from '../testing/senders.js';
import { addressAudience, notificationsOf, SEND_PATH, sendingSender, type SendingSender } from '../testing/sending.js';
import { ensureSaved, mjml, permitType, templatesApi } from '../testing/templates.js';
import { startTestIssuer, type TestIssuer } from '../testing/tokens.js';

const EXPIRING = 'permit-expiring';
const APPROVED = 'permit-approved';
const EXPIRING_DATA = { permit: { number: 'P-100', holder: 'Jane' }, expires_at: '2026-12-01' };

let t: TestApp;
let issuer: TestIssuer;
let admin: { authorization: string };
let permits: SendingSender;
let permitsCredential: { authorization: string };
let parks: SendingSender;
let parksCredential: { authorization: string };

beforeAll(async () => {
  issuer = await startTestIssuer();
  // No platform SMTP: email is usable only for senders with their own integration (AE8).
  t = await createTestApp({ env: issuer.env, issuerFetch: issuer.fetch });
  const adminToken = await issuer.ownClientUserToken({ admin: true });
  admin = bearer(adminToken);
  const templates = templatesApi(t, adminToken);
  await templates.defineType(permitType(EXPIRING));
  ensureSaved(
    await templates.save(EXPIRING, 'email', 'en-CA', {
      subject: 'Permit {{ permit.number }} expires',
      html: mjml('Expires {{ expires_at }}'),
    }),
  );
  [permits, parks] = await Promise.all([
    sendingSender(t, issuer, adminToken, 'permits', [EXPIRING, APPROVED]),
    sendingSender(t, issuer, adminToken, 'parks', [APPROVED]),
  ]);
  await Promise.all([permits.overrideEmail(), parks.overrideEmail()]);
  [permitsCredential, parksCredential] = await Promise.all([
    permits.credential('permits-client', [EXPIRING, APPROVED]),
    parks.credential('parks-client', [APPROVED]),
  ]);
});

afterAll(async () => {
  await t.close();
  await issuer.close();
});

const send = (credential: { authorization: string }, body: Record<string, unknown>) =>
  t
    .http()
    .post(SEND_PATH)
    .set(credential)
    .send({ type: EXPIRING, data: EXPIRING_DATA, idempotencyKey: randomUUID(), ...body });

const addressRecipient = (senderId: string, address: string) =>
  t.database.db
    .select({ id: recipients.id })
    .from(recipients)
    .where(and(eq(recipients.senderId, senderId), eq(recipients.address, address)));

describe('accepting a send (R26, R27, R29, KTD7)', () => {
  it('stores the notification with its sender, credential, data, audience, pins and policy before answering 202', async () => {
    const res = await send(permitsCredential, {
      data: { ...EXPIRING_DATA, undeclared: 'dropped' },
      audience: addressAudience('stored@example.com'),
    });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ notificationId: expect.any(String), status: 'accepted' });
    const [[recipient], [credential]] = await Promise.all([
      addressRecipient(permits.id, 'stored@example.com'),
      t.database.db.select({ id: credentials.id }).from(credentials).where(eq(credentials.clientId, 'permits-client')),
    ]);
    const stored = (await notificationsOf(t, permits.id)).find((row) => row.id === res.body.notificationId);
    expect(stored).toMatchObject({
      credentialId: credential?.id,
      typeKey: EXPIRING,
      data: EXPIRING_DATA,
      audienceKind: 'recipients',
      recipientIds: [recipient?.id],
      topicId: null,
      policy: { mode: 'all-at-once', channels: ['email', 'webhook'] },
      status: 'accepted',
      expandedAt: null,
    });
    expect(stored?.pinned).toMatchObject({
      typeKey: EXPIRING,
      defaultLanguage: 'en-CA',
      templates: { email: { 'en-CA': expect.any(String) } },
    });
  });

  it('covers AE16: an unknown issuer + subject with an email is pre-registered for the sender in the same send', async () => {
    const subject = `jane-${randomUUID()}`;
    const res = await send(permitsCredential, {
      audience: {
        kind: 'recipients',
        recipients: [
          { kind: 'user', issuer: issuer.issuer, subject, contactPoints: [{ channel: 'email', address: 'Jane@X.ca' }] },
        ],
      },
    });

    expect(res.status).toBe(202);
    const [user] = await t.database.db
      .select({ id: recipients.id, kind: recipients.kind })
      .from(recipients)
      .where(and(eq(recipients.issuer, issuer.issuer), eq(recipients.subject, subject)));
    expect(user?.kind).toBe('user');
    const userId = user?.id ?? '';
    const [registrations, points, stored] = await Promise.all([
      t.database.db.select().from(recipientRegistrations).where(eq(recipientRegistrations.recipientId, userId)),
      t.database.db.select().from(contactPoints).where(eq(contactPoints.recipientId, userId)),
      notificationsOf(t, permits.id),
    ]);
    expect(registrations.map((row) => row.senderId)).toEqual([permits.id]);
    expect(points).toMatchObject([{ channel: 'email', address: 'jane@x.ca', ownerSenderId: permits.id }]);
    expect(stored.find((row) => row.id === res.body.notificationId)?.recipientIds).toEqual([userId]);
  });

  it('covers AE6: sends to Jane@Example.com and jane@example.com reference one address-only recipient', async () => {
    const first = await send(permitsCredential, { audience: addressAudience('Jane@Example.com') });
    const second = await send(permitsCredential, { audience: addressAudience('jane@example.com') });

    expect([first.status, second.status]).toEqual([202, 202]);
    const found = await addressRecipient(permits.id, 'jane@example.com');
    expect(found).toHaveLength(1);
    const stored = await notificationsOf(t, permits.id);
    const ids = [first.body.notificationId, second.body.notificationId].map(
      (id) => stored.find((row) => row.id === id)?.recipientIds,
    );
    expect(ids).toEqual([[found[0]?.id], [found[0]?.id]]);
  });

  it("resolves the sender's own system recipient and stores topic and everyone audiences without expanding them", async () => {
    const system = await t
      .http()
      .post('/api/v1/recipients/systems')
      .set(permitsCredential)
      .send({ systemId: 'permits-gateway', webhookUrls: ['https://hooks.example.com/permits'] });
    const topic = await t.http().post('/api/v1/topics').set(permitsCredential).send({ key: 'p-1', name: 'Permit 1' });
    expect([system.status, topic.status]).toEqual([200, 201]);

    const toSystem = await send(permitsCredential, {
      audience: { kind: 'recipients', recipients: [{ kind: 'system', systemId: 'permits-gateway' }] },
    });
    const toTopic = await send(permitsCredential, { audience: { kind: 'topic', topicId: topic.body.id } });
    const toEveryone = await send(permitsCredential, { audience: { kind: 'everyone' } });

    expect([toSystem.status, toTopic.status, toEveryone.status]).toEqual([202, 202, 202]);
    const [systemRow] = await t.database.db
      .select({ id: recipients.id })
      .from(recipients)
      .where(and(eq(recipients.senderId, permits.id), eq(recipients.systemId, 'permits-gateway')));
    const stored = await notificationsOf(t, permits.id);
    const audienceOf = (id: unknown) => {
      const row = stored.find((notification) => notification.id === id);
      return row && { kind: row.audienceKind, recipientIds: row.recipientIds, topicId: row.topicId };
    };
    expect(audienceOf(toSystem.body.notificationId)).toEqual({
      kind: 'recipients',
      recipientIds: [systemRow?.id],
      topicId: null,
    });
    expect(audienceOf(toTopic.body.notificationId)).toEqual({
      kind: 'topic',
      recipientIds: null,
      topicId: topic.body.id,
    });
    expect(audienceOf(toEveryone.body.notificationId)).toEqual({ kind: 'everyone', recipientIds: null, topicId: null });
  });
});

describe('request-time rejections (R28)', () => {
  it('covers AE7: a send missing permit.number is rejected and nothing is stored', async () => {
    const before = await notificationsOf(t, permits.id);

    const res = await send(permitsCredential, {
      data: { permit: { holder: 'Jane' }, expires_at: '2026-12-01' },
      audience: addressAudience('ae7@example.com'),
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'The send failed its checks',
      errors: [expect.stringMatching(/^data\.permit\.number: /)],
    });
    expect(await notificationsOf(t, permits.id)).toHaveLength(before.length);
    expect(await addressRecipient(permits.id, 'ae7@example.com')).toEqual([]);
  });

  it('covers AE8: a policy needing email is rejected when there is no default and no sender override', async () => {
    const adminToken = await issuer.ownClientUserToken({ admin: true });
    const noEmail = await sendingSender(t, issuer, adminToken, 'no-email', [APPROVED]);
    const credential = await noEmail.credential('no-email-client', [APPROVED]);

    const res = await send(credential, { type: APPROVED, data: { reference: 'R-1' }, audience: { kind: 'everyone' } });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(['type: The policy needs email, which has no usable integration for this sender']);
    expect(await notificationsOf(t, noEmail.id)).toEqual([]);
  });

  it('covers F5: a credential scoped to type A sending type B is rejected', async () => {
    const narrow = await permits.credential('permits-narrow', [APPROVED]);

    const res = await send(narrow, { type: EXPIRING, audience: { kind: 'everyone' } });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('This credential is not scoped to the type');
  });

  it("rejects a platform topic the sender isn't granted, another sender's topic and an unknown topic", async () => {
    const platform = await t.http().post('/api/v1/admin/topics').set(admin).send({ key: 'outages', name: 'Outages' });
    const parksTopic = await t.http().post('/api/v1/topics').set(parksCredential).send({ key: 'k-1', name: 'Park 1' });
    expect([platform.status, parksTopic.status]).toEqual([201, 201]);

    const results = await Promise.all(
      [platform.body.id, parksTopic.body.id, randomUUID()].map((topicId) =>
        send(permitsCredential, { audience: { kind: 'topic', topicId } }),
      ),
    );

    for (const res of results) {
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(['audience.topicId: No topic this sender may broadcast to']);
    }
  });

  it("rejects the whole send when one recipient is another sender's system, storing none of it", async () => {
    const registered = await t
      .http()
      .post('/api/v1/recipients/systems')
      .set(parksCredential)
      .send({ systemId: 'parks-gateway', webhookUrls: ['https://hooks.example.com/parks'] });
    expect(registered.status).toBe(200);
    const before = await notificationsOf(t, permits.id);

    const res = await send(permitsCredential, {
      audience: {
        kind: 'recipients',
        recipients: [
          { kind: 'address', channel: 'email', address: 'bystander@example.com' },
          { kind: 'system', systemId: 'parks-gateway' },
        ],
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(['audience.recipients.1.systemId: No system recipient with this id']);
    expect(await notificationsOf(t, permits.id)).toHaveLength(before.length);
    expect(await addressRecipient(permits.id, 'bystander@example.com')).toEqual([]);
  });

  it('rejects a malformed address with its recipient index', async () => {
    const res = await send(permitsCredential, { audience: addressAudience('not-an-address') });

    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(['audience.recipients.0.address: Must be an email address']);
  });

  it('accepts a body of 200 KB and rejects one over 256 KB', async () => {
    const [fits, tooLarge] = await Promise.all(
      [200, 257].map((kilobytes) =>
        send(permitsCredential, {
          data: { ...EXPIRING_DATA, message: 'x'.repeat(kilobytes * 1024) },
          audience: { kind: 'everyone' },
        }),
      ),
    );

    expect([fits?.status, tooLarge?.status]).toEqual([202, 413]);
  });
});
