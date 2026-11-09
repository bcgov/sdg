import { randomUUID } from 'node:crypto';

import { confirmationSends, verificationTokens } from '@repo/notification-database';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';
import {
  confirmationToken,
  messagesTo,
  platformSmtpEnv,
  senderWithCredential,
  usableEmails,
  type CredentialSender,
} from '../testing/recipients.js';
import { bearer } from '../testing/senders.js';
import { startTestSmtpServer, type TestSmtpServer } from '../testing/smtp-server.js';
import { startTestIssuer, type TestIssuer } from '../testing/tokens.js';
import { ContactPointsService } from './contact-points.service.js';

let t: TestApp;
let issuer: TestIssuer;
let smtp: TestSmtpServer;
let sender: CredentialSender;

beforeAll(async () => {
  [issuer, smtp] = await Promise.all([startTestIssuer(), startTestSmtpServer()]);
  t = await createTestApp({ env: { ...issuer.env, ...platformSmtpEnv(smtp) }, issuerFetch: issuer.fetch });
  sender = await senderWithCredential(t, issuer, await issuer.ownClientUserToken({ admin: true }), 'permits');
});

afterAll(async () => {
  await t.close();
  await Promise.all([issuer.close(), smtp.close()]);
});

/** A new user's relayed token; the IdP email is verified unless the claims say otherwise. */
async function newUser(claims: Record<string, unknown> = {}): Promise<{ authorization: string }> {
  return bearer(await issuer.relayingUserToken({ subject: randomUUID(), claims }));
}

async function recipientId(user: { authorization: string }): Promise<string> {
  const me = await t.http().get('/api/v1/me').set(user);
  expect(me.status).toBe(200);
  return String(me.body.id);
}

async function addEmail(user: { authorization: string }, address: string) {
  return t.http().post('/api/v1/me/contact-points').set(user).send({ channel: 'email', address });
}

const confirm = (token: string) => t.http().post('/api/v1/contact-points/confirm').send({ token });

const resend = (user: { authorization: string }, id: unknown) =>
  t
    .http()
    .post(`/api/v1/me/contact-points/${String(id)}/resend`)
    .set(user);

/** Runs `request` while the platform SMTP server refuses every message. */
async function whileSmtpFails<T>(request: () => Promise<T>): Promise<T> {
  smtp.failing = true;
  try {
    return await request();
  } finally {
    smtp.failing = false;
  }
}

const sendsTo = async (address: string) =>
  (await t.database.db.select().from(confirmationSends).where(eq(confirmationSends.address, address))).length;

describe('the IdP email seed (R32, R35)', () => {
  it('stores an email the token does not mark verified as unverified, and sends it a confirmation', async () => {
    const address = `${randomUUID()}@example.com`;
    const user = await newUser({ email: address, email_verified: false });

    const points = await t.http().get('/api/v1/me/contact-points').set(user);

    expect(points.status).toBe(200);
    expect(points.body).toEqual([expect.objectContaining({ address, verified: false, source: 'idp' })]);
    expect(messagesTo(smtp, address)).toBe(1);
    expect(await confirm(confirmationToken(smtp, address))).toHaveProperty('status', 204);
    const confirmed = await t.http().get('/api/v1/me/contact-points').set(user);
    expect(confirmed.body).toEqual([expect.objectContaining({ address, verified: true })]);
  });

  it('stores a verified IdP email as verified, without a confirmation', async () => {
    const address = `${randomUUID()}@example.com`;
    const user = await newUser({ email: address, email_verified: true });

    const points = await t.http().get('/api/v1/me/contact-points').set(user);

    expect(points.body).toEqual([expect.objectContaining({ address, verified: true, source: 'idp' })]);
    expect(messagesTo(smtp, address)).toBe(0);
  });
});

describe('addresses the user adds (R35, KTD15)', () => {
  it('Covers AE4: second@example.com receives nothing until it is confirmed', async () => {
    const first = `${randomUUID()}@example.com`;
    const user = await newUser({ email: first });
    const recipient = await recipientId(user);

    const added = await addEmail(user, ' Second@Example.com ');

    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({
      channel: 'email',
      address: 'second@example.com',
      verified: false,
      source: 'user',
    });
    expect(await usableEmails(t, recipient, sender.id)).toEqual([first]);
    const usable = await t.app.get(ContactPointsService).usable(recipient, 'email', sender.id);
    expect(usable.pendingVerification).toBe(true);

    expect(await confirm(confirmationToken(smtp, 'second@example.com'))).toHaveProperty('status', 204);
    expect(await usableEmails(t, recipient, sender.id)).toEqual([first, 'second@example.com']);
  });

  it('confirms once per token: the second use is rejected', async () => {
    const user = await newUser();
    const address = `${randomUUID()}@example.com`;
    expect((await addEmail(user, address)).status).toBe(201);
    const token = confirmationToken(smtp, address);

    const [once, twice] = [await confirm(token), await confirm(token)];

    expect(once.status).toBe(204);
    expect(twice.status).toBe(400);
    expect(twice.body.message).toBe('This confirmation link is invalid, already used or expired');
  });

  it('rejects an expired token and leaves the address unverified', async () => {
    const user = await newUser();
    const address = `${randomUUID()}@example.com`;
    const added = await addEmail(user, address);
    await t.database.db
      .update(verificationTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verificationTokens.contactPointId, String(added.body.id)));

    const expired = await confirm(confirmationToken(smtp, address));

    expect(expired.status).toBe(400);
    const points = await t.http().get('/api/v1/me/contact-points').set(user);
    expect(points.body).toContainEqual(expect.objectContaining({ address, verified: false }));
  });

  it('makes an edited address unusable until the new one is confirmed, and the old link no longer works', async () => {
    const user = await newUser();
    const recipient = await recipientId(user);
    const before = `${randomUUID()}@example.com`;
    const after = `${randomUUID()}@example.com`;
    const added = await addEmail(user, before);
    const oldToken = confirmationToken(smtp, before);
    expect((await confirm(oldToken)).status).toBe(204);

    const edited = await t
      .http()
      .patch(`/api/v1/me/contact-points/${added.body.id}`)
      .set(user)
      .send({ address: after });

    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ address: after, verified: false });
    expect(await usableEmails(t, recipient, sender.id)).not.toContain(after);
    expect((await confirm(oldToken)).status).toBe(400);
    expect((await confirm(confirmationToken(smtp, after))).status).toBe(204);
    expect(await usableEmails(t, recipient, sender.id)).toContain(after);
  });
});

describe('confirmation rate limits (R36)', () => {
  it('rejects a sixth confirmation send for one recipient within an hour with a clear error', async () => {
    const user = await newUser();
    const five = await Promise.all(Array.from({ length: 5 }, () => addEmail(user, `${randomUUID()}@example.com`)));
    expect(five.map((res) => res.status)).toEqual([201, 201, 201, 201, 201]);
    const sixth = `${randomUUID()}@example.com`;

    const rejected = await addEmail(user, sixth);

    expect(rejected.status).toBe(429);
    expect(rejected.body.message).toBe('Too many confirmation emails in the last hour: try again later');
    expect(messagesTo(smtp, sixth)).toBe(0);
    const points = await t.http().get('/api/v1/me/contact-points').set(user);
    expect(points.body.map((point: { address: string }) => point.address)).not.toContain(sixth);
  });

  it('rejects a fourth confirmation send to one address within an hour, whoever asks', async () => {
    const address = `${randomUUID()}@example.com`;
    const users = await Promise.all([newUser(), newUser(), newUser()]);
    const three = await Promise.all(users.map((user) => addEmail(user, address)));
    expect(three.map((res) => res.status)).toEqual([201, 201, 201]);

    const rejected = await addEmail(await newUser(), address);

    expect(rejected.status).toBe(429);
    expect(rejected.body.message).toBe(
      'Too many confirmation emails to this address in the last hour: try again later',
    );
    expect(messagesTo(smtp, address)).toBe(3);
  });

  it('makes a pending address wait 10 minutes before it is sent another confirmation', async () => {
    const user = await newUser();
    const address = `${randomUUID()}@example.com`;
    const added = await addEmail(user, address);

    const resent = await t.http().post(`/api/v1/me/contact-points/${added.body.id}/resend`).set(user);

    expect(resent.status).toBe(429);
    expect(resent.body.retryAfterSeconds).toBeGreaterThan(590);
    expect(messagesTo(smtp, address)).toBe(1);
  });
});

describe('a confirmation the platform SMTP fails to send (R36)', () => {
  it('answers 502 on add, counts nothing, and a resend once SMTP is back goes out and is then counted', async () => {
    const user = await newUser();
    const address = `${randomUUID()}@example.com`;

    const added = await whileSmtpFails(() => addEmail(user, address));

    expect(added.status).toBe(502);
    expect(await sendsTo(address)).toBe(0);
    const point = (await t.http().get('/api/v1/me/contact-points').set(user)).body.find(
      (row: { address: string }) => row.address === address,
    );
    expect(point).toMatchObject({ verified: false });
    expect(
      await t.database.db.select().from(verificationTokens).where(eq(verificationTokens.address, address)),
    ).toEqual([]);

    expect((await resend(user, point.id)).status).toBe(204);
    expect(messagesTo(smtp, address)).toBe(1);
    expect(await sendsTo(address)).toBe(1);
    expect((await resend(user, point.id)).status).toBe(429);
    expect((await confirm(confirmationToken(smtp, address))).status).toBe(204);
  });

  it('releases the reservation of a failed edit and a failed resend, so the next resend goes out', async () => {
    const user = await newUser();
    const before = `${randomUUID()}@example.com`;
    const after = `${randomUUID()}@example.com`;
    const added = await addEmail(user, before);
    expect(added.status).toBe(201);

    const edited = await whileSmtpFails(() =>
      t.http().patch(`/api/v1/me/contact-points/${added.body.id}`).set(user).send({ address: after }),
    );
    const resentWhileFailing = await whileSmtpFails(() => resend(user, added.body.id));

    expect([edited.status, resentWhileFailing.status]).toEqual([502, 502]);
    expect(await sendsTo(after)).toBe(0);
    expect((await resend(user, added.body.id)).status).toBe(204);
    expect(messagesTo(smtp, after)).toBe(1);
    expect(await sendsTo(after)).toBe(1);
  });
});

describe('the confirmation email', () => {
  it('goes out at once through the platform default integration, with the built-in template', async () => {
    const address = `${randomUUID()}@example.com`;

    await addEmail(await newUser(), address);

    const raw = smtp.messages.at(-1) ?? '';
    expect(raw).toMatch(new RegExp(`^To: ${address.replaceAll('.', '\\.')}$`, 'm'));
    expect(raw).toMatch(/^From: notify@platform\.example\.com$/m);
    expect(raw).toMatch(/^Subject: Confirm your email address$/m);
  });
});
