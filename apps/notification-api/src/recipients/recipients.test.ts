import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recipients } from '../database/schema/index.js';
import { createTestApp, type TestApp } from '../testing/app.js';
import { senderWithCredential, type CredentialSender } from '../testing/recipients.js';
import { bearer } from '../testing/senders.js';
import { startTestIssuer, type TestIssuer } from '../testing/tokens.js';
import { ContactPointsService } from './contact-points.service.js';
import { RecipientsService } from './recipients.service.js';

let t: TestApp;
let issuer: TestIssuer;
let permits: CredentialSender;
let parks: CredentialSender;

// No platform default email integration: this file's app cannot send confirmations.
beforeAll(async () => {
  issuer = await startTestIssuer();
  t = await createTestApp({
    env: issuer.env,
    issuerFetch: issuer.fetch,
  });
  const adminToken = await issuer.ownClientUserToken({ admin: true });
  [permits, parks] = await Promise.all([
    senderWithCredential(t, issuer, adminToken, 'permits'),
    senderWithCredential(t, issuer, adminToken, 'parks'),
  ]);
});

afterAll(async () => {
  await t.close();
  await issuer.close();
});

const preRegister = (sender: CredentialSender, subject: string, emails: readonly string[] = []) =>
  t
    .http()
    .post('/api/v1/recipients/users')
    .set(sender.credential)
    .send({ issuer: issuer.issuer, subject, contactPoints: emails.map((address) => ({ channel: 'email', address })) });

const relayed = async (subject: string, claims: Record<string, unknown> = {}) =>
  bearer(await issuer.relayingUserToken({ subject, claims }));

const userRows = (subject: string) =>
  t.database.db
    .select({ id: recipients.id, claimedAt: recipients.claimedAt })
    .from(recipients)
    .where(and(eq(recipients.issuer, issuer.issuer), eq(recipients.subject, subject)));

const usableEmails = async (recipientId: string, senderId: string): Promise<string[]> => {
  const usable = await t.app.get(ContactPointsService).usable(recipientId, 'email', senderId);
  return usable.points.map((point) => point.address);
};

describe('user recipients (R32, R33)', () => {
  it('Covers AE13: a user a sender pre-registered is claimed by their first relayed call, as the same recipient', async () => {
    const subject = randomUUID();
    const registered = await preRegister(permits, subject, ['pat@permits.example.com']);
    expect(registered.status).toBe(200);
    expect(registered.body).toEqual({ issuer: issuer.issuer, subject });
    const [before] = await userRows(subject);
    expect(before?.claimedAt).toBeNull();

    const me = await t
      .http()
      .get('/api/v1/me')
      .set(await relayed(subject, { email: 'pat@example.com' }));

    expect(me.status).toBe(200);
    const rows = await userRows(subject);
    expect(rows).toEqual([{ id: before?.id, claimedAt: expect.any(Date) }]);
    expect(me.body.id).toBe(before?.id);
  });

  it('a relayed first call and a pre-registration at the same time produce one recipient', async () => {
    const subject = randomUUID();
    const user = await relayed(subject);

    const [me, registered] = await Promise.all([t.http().get('/api/v1/me').set(user), preRegister(permits, subject)]);

    expect([me.status, registered.status]).toEqual([200, 200]);
    const rows = await userRows(subject);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(me.body.id);
  });

  it('pre-registering a known user only adds that sender’s contact points and returns the same response', async () => {
    const subject = randomUUID();
    const first = await preRegister(permits, subject, ['one@example.com']);

    const again = await preRegister(parks, subject, ['two@example.com']);

    expect(again.status).toBe(first.status);
    expect(again.body).toEqual(first.body);
    const [row] = await userRows(subject);
    expect(await usableEmails(String(row?.id), permits.id)).toEqual(['one@example.com']);
    expect(await usableEmails(String(row?.id), parks.id)).toEqual(['two@example.com']);
  });

  it('Covers AE5: a sender-supplied email is usable without verification, but only for that sender and never shown to the user', async () => {
    const subject = randomUUID();
    await preRegister(permits, subject, ['pat@permits.example.com']);
    const user = await relayed(subject, { email: 'pat@example.com', email_verified: true });

    const own = await t.http().get('/api/v1/me/contact-points').set(user);

    expect(own.body.map((point: { address: string }) => point.address)).toEqual(['pat@example.com']);
    const [row] = await userRows(subject);
    const id = String(row?.id);
    expect((await usableEmails(id, permits.id)).toSorted()).toEqual(['pat@example.com', 'pat@permits.example.com']);
    expect(await usableEmails(id, parks.id)).toEqual(['pat@example.com']);
  });

  it('never re-adds a seeded IdP email the user removed', async () => {
    const subject = randomUUID();
    const user = await relayed(subject, { email: 'seed@example.com', email_verified: true });
    const [seed] = (await t.http().get('/api/v1/me/contact-points').set(user)).body;

    const removed = await t.http().delete(`/api/v1/me/contact-points/${seed.id}`).set(user);
    const later = await t
      .http()
      .get('/api/v1/me/contact-points')
      .set(await relayed(subject, { email: 'seed@example.com' }));

    expect(removed.status).toBe(204);
    expect(later.body).toEqual([]);
  });

  it('rejects adding an email contact point when there is no platform default email integration', async () => {
    const user = await relayed(randomUUID());

    const added = await t
      .http()
      .post('/api/v1/me/contact-points')
      .set(user)
      .send({ channel: 'email', address: 'pat@example.com' });

    expect(added.status).toBe(422);
    expect(added.body.message).toBe(
      'Email addresses cannot be added: no platform email integration is configured to send the confirmation',
    );
    const own = await t.http().get('/api/v1/me/contact-points').set(user);
    expect(own.body.map((point: { address: string }) => point.address)).not.toContain('pat@example.com');
  });

  it('never lets a service-account token reach the recipient endpoints', async () => {
    const res = await t.http().get('/api/v1/me').set(permits.credential);

    expect(res.status).toBe(403);
  });
});

describe('recipient settings (R37, R39, R40)', () => {
  it('sets language, timezone and quiet hours, and switches email off', async () => {
    const user = await relayed(randomUUID());

    const updated = await t
      .http()
      .patch('/api/v1/me')
      .set(user)
      .send({ language: 'fr-ca', timeZone: 'America/Toronto', quietHours: { start: '22:00', end: '07:00' } });
    const switched = await t.http().put('/api/v1/me/channels/email').set(user).send({ enabled: false });

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      language: 'fr-CA',
      timeZone: 'America/Toronto',
      quietHours: { start: '22:00', end: '07:00' },
    });
    expect(switched.status).toBe(200);
    expect(switched.body.channels).toEqual([
      { channel: 'in-app', enabled: true, switchable: false },
      { channel: 'email', enabled: false, switchable: true },
    ]);
    const on = await t.http().put('/api/v1/me/channels/email').set(user).send({ enabled: true });
    expect(on.body.channels).toContainEqual({ channel: 'email', enabled: true, switchable: true });
  });

  it('does not let in-app be switched off', async () => {
    const user = await relayed(randomUUID());

    const res = await t.http().put('/api/v1/me/channels/in-app').set(user).send({ enabled: false });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('The in-app channel cannot be switched off');
    expect((await t.http().get('/api/v1/me').set(user)).body.channels).toContainEqual({
      channel: 'in-app',
      enabled: true,
      switchable: false,
    });
  });

  it('rejects an unknown timezone and quiet hours that start and end at the same time', async () => {
    const user = await relayed(randomUUID());

    const zone = await t.http().patch('/api/v1/me').set(user).send({ timeZone: 'Mars/Olympus' });
    const hours = await t
      .http()
      .patch('/api/v1/me')
      .set(user)
      .send({ quietHours: { start: '07:00', end: '07:00' } });

    expect([zone.status, hours.status]).toEqual([400, 400]);
  });

  it('lets a sender set language and timezone on its address-only recipient (R39)', async () => {
    const res = await t
      .http()
      .post('/api/v1/recipients/addresses')
      .set(permits.credential)
      .send({ channel: 'email', address: ' Jane@Example.COM', language: 'fr-CA', timeZone: 'America/Montreal' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      channel: 'email',
      address: 'jane@example.com',
      language: 'fr-CA',
      timeZone: 'America/Montreal',
    });
  });
});

describe('address-only recipients (R27, KTD17)', () => {
  it('matches ` Jane@Example.COM` and `jane@example.com` to one recipient per sender, and keeps senders apart', async () => {
    const service = t.app.get(RecipientsService);

    const [first, second, other] = await Promise.all([
      service.upsertAddressRecipient(permits.id, { channel: 'email', address: ' Jane@Example.COM' }),
      service.upsertAddressRecipient(permits.id, { channel: 'email', address: 'jane@example.com' }),
      service.upsertAddressRecipient(parks.id, { channel: 'email', address: 'jane@example.com' }),
    ]);

    expect(second).toBe(first);
    expect(other).not.toBe(first);
    expect(await usableEmails(first, permits.id)).toEqual(['jane@example.com']);
    expect(await usableEmails(first, parks.id)).toEqual([]);
  });
});
