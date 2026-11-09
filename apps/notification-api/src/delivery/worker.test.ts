import type { DeliveryPolicy } from '@repo/notification-database';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  attemptsOf,
  defineDeliveryType,
  deliveriesOf,
  inboxItemsOf,
  notificationRecipientId,
  relayedUser,
  runWorker,
  sendNotification,
  startDeliveryApp,
  type DeliveryApp,
} from '../testing/delivery.js';
import { messagesTo } from '../testing/recipients.js';
import { sendingSender } from '../testing/sending.js';
import { cancelPendingSteps } from './escalation.js';

const ESCALATING = 'escalating-alert';
const QUIET_STEP = 'quiet-step-alert';
const EMAIL_NOW = 'email-alert';
const NO_EMAIL_TEMPLATE = 'in-app-only-alert';
const FRENCH_TOO = 'bilingual-alert';
const TYPES = [ESCALATING, QUIET_STEP, EMAIL_NOW, NO_EMAIL_TEMPLATE, FRENCH_TOO];

let app: DeliveryApp;
let credential: { authorization: string };

beforeAll(async () => {
  app = await startDeliveryApp();
  const email: DeliveryPolicy = { mode: 'all-at-once', channels: ['email'] };
  await defineDeliveryType(app.t, app.adminToken, {
    key: ESCALATING,
    policy: { mode: 'escalation', steps: [{ channel: 'email', delayMinutes: 60 }] },
  });
  await defineDeliveryType(app.t, app.adminToken, {
    key: QUIET_STEP,
    policy: { mode: 'escalation', steps: [{ channel: 'email', delayMinutes: 30 }] },
  });
  await defineDeliveryType(app.t, app.adminToken, { key: EMAIL_NOW, policy: email });
  await defineDeliveryType(app.t, app.adminToken, {
    key: NO_EMAIL_TEMPLATE,
    policy: email,
    templates: { 'in-app': ['en-CA'] },
  });
  await defineDeliveryType(app.t, app.adminToken, {
    key: FRENCH_TOO,
    policy: email,
    templates: { email: ['en-CA', 'fr-CA'], 'in-app': ['en-CA'] },
  });
  const sender = await sendingSender(app.t, app.issuer, app.adminToken, 'worker-sender', TYPES);
  credential = await sender.credential('worker-sender-client', TYPES);
});

afterAll(() => app.close());

describe('escalation (R18, KTD8)', () => {
  it('covers AE1: reading the in-app item at minute 20 cancels the 60-minute email step', async () => {
    const user = await relayedUser(app);
    const sentAt = app.clock.now();
    const notificationId = await sendNotification(app.t, credential, ESCALATING, user.audience);
    await runWorker(app.t);

    const [item] = await inboxItemsOf(app.t, notificationId);
    expect(item).toMatchObject({ recipientId: user.recipientId, title: 'Alert R-1', createdAt: sentAt });
    const [step] = await deliveriesOf(app.t, notificationId);
    expect(step).toMatchObject({ step: 1, status: 'scheduled', dueAt: new Date(sentAt.getTime() + 60 * 60_000) });

    app.clock.advanceMinutes(20);
    const nr = await notificationRecipientId(app.t, notificationId, user.recipientId);
    expect(await cancelPendingSteps(app.t.database.db, nr, 'read', app.clock.now())).toBe(1);
    app.clock.advanceMinutes(45);
    await runWorker(app.t);

    expect(await deliveriesOf(app.t, notificationId)).toMatchObject([{ status: 'cancelled', reason: 'read in app' }]);
    expect(messagesTo(app.smtp, user.email)).toBe(0);
  });

  it('sends the unread step once its delay has passed, to the email Message-ID of the delivery (R53)', async () => {
    const user = await relayedUser(app);
    const notificationId = await sendNotification(app.t, credential, ESCALATING, user.audience);
    await runWorker(app.t);
    app.clock.advanceMinutes(59);
    await runWorker(app.t);
    expect(messagesTo(app.smtp, user.email)).toBe(0);

    app.clock.advanceMinutes(1);
    await runWorker(app.t);

    const [delivery] = await deliveriesOf(app.t, notificationId);
    expect(delivery).toMatchObject({ status: 'delivered', attempts: 1, address: user.email });
    const message = app.smtp.messages.find((raw) => raw.includes(`To: ${user.email}`));
    expect(message).toContain(`Message-ID: <${delivery?.id}@platform.example.com>`);
    expect(await attemptsOf(app.t, delivery?.id ?? '')).toMatchObject([
      { attempt: 1, status: 'accepted', integrationId: 'platform:email', rendered: { subject: 'Alert R-1' } },
    ]);
  });
});

describe('quiet hours (R40)', () => {
  it('covers AE2: a step due at 23:30 inside 22:00–07:00 is sent at 07:00, while the in-app item appears at once', async () => {
    const user = await relayedUser(app);
    const settings = { timeZone: 'America/Los_Angeles', quietHours: { start: '22:00', end: '07:00' } };
    expect((await app.t.http().patch('/api/v1/me').set(user.auth).send(settings)).status).toBe(200);
    // 23:00 PST on Tuesday 5 January 2027; the step is due at 23:30.
    app.clock.set('2027-01-06T07:00:00Z');
    const notificationId = await sendNotification(app.t, credential, QUIET_STEP, user.audience);
    await runWorker(app.t);
    expect(await inboxItemsOf(app.t, notificationId)).toMatchObject([{ createdAt: new Date('2027-01-06T07:00:00Z') }]);

    app.clock.set('2027-01-06T07:30:00Z');
    await runWorker(app.t);
    expect(await deliveriesOf(app.t, notificationId)).toMatchObject([
      { status: 'scheduled', attempts: 0, dueAt: new Date('2027-01-06T15:00:00Z') },
    ]);
    expect(messagesTo(app.smtp, user.email)).toBe(0);

    app.clock.set('2027-01-06T15:00:00Z');
    await runWorker(app.t);
    expect(await deliveriesOf(app.t, notificationId)).toMatchObject([{ status: 'delivered', attempts: 1 }]);
    expect(messagesTo(app.smtp, user.email)).toBe(1);
  });
});

describe('re-checks at claim (KTD7)', () => {
  it('covers AE3: with email switched off the item lands in the inbox and the email is skipped as "channel off"', async () => {
    const user = await relayedUser(app);
    const off = await app.t.http().put('/api/v1/me/channels/email').set(user.auth).send({ enabled: false });
    expect(off.status).toBe(200);
    const notificationId = await sendNotification(app.t, credential, EMAIL_NOW, user.audience);
    await runWorker(app.t);

    expect(await inboxItemsOf(app.t, notificationId)).toMatchObject([{ recipientId: user.recipientId }]);
    expect(await deliveriesOf(app.t, notificationId)).toMatchObject([
      { channel: 'email', status: 'skipped', reason: 'channel off', attempts: 0 },
    ]);
    expect(messagesTo(app.smtp, user.email)).toBe(0);
  });

  it('records the email of a type with no email template as skipped with "no template" (R14)', async () => {
    const user = await relayedUser(app);
    const notificationId = await sendNotification(app.t, credential, NO_EMAIL_TEMPLATE, user.audience);
    await runWorker(app.t);

    expect(await deliveriesOf(app.t, notificationId)).toMatchObject([{ status: 'skipped', reason: 'no template' }]);
    expect(await inboxItemsOf(app.t, notificationId)).toMatchObject([{ title: 'Alert R-1' }]);
    expect(messagesTo(app.smtp, user.email)).toBe(0);
  });

  it('covers AE9: a French-preferring user gets the English template of an English-only type', async () => {
    const [english, french] = await Promise.all([relayedUser(app), relayedUser(app)]);
    await Promise.all(
      [english, french].map(async (user) => {
        const res = await app.t.http().patch('/api/v1/me').set(user.auth).send({ language: 'fr-CA' });
        expect(res.status).toBe(200);
      }),
    );
    const [englishOnly, bilingual] = await Promise.all([
      sendNotification(app.t, credential, EMAIL_NOW, english.audience),
      sendNotification(app.t, credential, FRENCH_TOO, french.audience),
    ]);
    await runWorker(app.t);

    const subjectOf = async (notificationId: string) => {
      const [delivery] = await deliveriesOf(app.t, notificationId);
      const [attempt] = await attemptsOf(app.t, delivery?.id ?? '');
      return attempt?.rendered?.channel === 'email' ? attempt.rendered.subject : undefined;
    };
    expect(await subjectOf(englishOnly)).toBe('Alert R-1');
    // The same preference picks the French template where the type has one.
    expect(await subjectOf(bilingual)).toBe('Alerte R-1');
  });
});

describe('the worker loop (KTD4)', () => {
  it('polls for work on its own and drains on shutdown', async () => {
    const polling = await startDeliveryApp({ env: { NOTIFICATION_WORKER_POLL_MS: '20' } });
    try {
      await defineDeliveryType(polling.t, polling.adminToken, {
        key: EMAIL_NOW,
        policy: { mode: 'all-at-once', channels: ['email'] },
      });
      const pollingSender = await sendingSender(polling.t, polling.issuer, polling.adminToken, 'polled', [EMAIL_NOW]);
      const polled = await pollingSender.credential('polled-client', [EMAIL_NOW]);
      const audience = {
        kind: 'recipients',
        recipients: [{ kind: 'address', channel: 'email', address: 'polled@example.com' }],
      };
      const notificationId = await sendNotification(polling.t, polled, EMAIL_NOW, audience);

      await vi.waitFor(async () => {
        expect(await deliveriesOf(polling.t, notificationId)).toMatchObject([{ status: 'delivered' }]);
      });
      expect(messagesTo(polling.smtp, 'polled@example.com')).toBe(1);
    } finally {
      await polling.close();
    }
  });
});
