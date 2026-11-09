import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  attemptsOf,
  defineDeliveryType,
  deliveriesOf,
  inboxItemsOf,
  notificationRecipientId,
  registerSystem,
  relayedUser,
  runWorker,
  sendNotification,
  startDeliveryApp,
  systemAudience,
  type DeliveryApp,
} from '../testing/delivery.js';
import { messagesTo } from '../testing/recipients.js';
import { addressAudience, sendingSender } from '../testing/sending.js';
import { ensureSaved, mjml, templatesApi } from '../testing/templates.js';
import { cancelPendingSteps } from './escalation.js';

const EMAIL = 'planned-email';
const STEPS = 'planned-steps';
const BOTH = 'planned-both';
const LINKED = 'planned-portal-link';
const TYPES = [EMAIL, STEPS, BOTH, LINKED];
const PORTAL_LINK = '{% if recipient.hasInbox %}https://portal.example/inbox/{{ notification.id }}{% endif %}';

let app: DeliveryApp;
let credential: { authorization: string };

beforeAll(async () => {
  app = await startDeliveryApp();
  await defineDeliveryType(app.t, app.adminToken, { key: EMAIL, policy: { mode: 'all-at-once', channels: ['email'] } });
  await defineDeliveryType(app.t, app.adminToken, {
    key: STEPS,
    policy: {
      mode: 'escalation',
      steps: [
        { channel: 'email', delayMinutes: 10 },
        { channel: 'email', delayMinutes: 30 },
      ],
    },
  });
  await defineDeliveryType(app.t, app.adminToken, {
    key: BOTH,
    policy: { mode: 'all-at-once', channels: ['email', 'webhook'] },
  });
  await defineDeliveryType(app.t, app.adminToken, {
    key: LINKED,
    policy: { mode: 'all-at-once', channels: ['email'] },
  });
  const templates = templatesApi(app.t, app.adminToken);
  const saves = await Promise.all([
    templates.save(LINKED, 'in-app', 'en-CA', { title: 'Alert', body: 'x', actionUrl: '/inbox/{{ notification.id }}' }),
    templates.save(LINKED, 'email', 'en-CA', {
      subject: 'Alert',
      html: mjml(`Open ${PORTAL_LINK}`),
      text: `Open ${PORTAL_LINK}`,
    }),
  ]);
  saves.forEach(ensureSaved);
  const sender = await sendingSender(app.t, app.issuer, app.adminToken, 'planner-sender', TYPES);
  credential = await sender.credential('planner-sender-client', TYPES);
});

afterAll(() => app.close());

describe('deduplicating email by address (KTD14)', () => {
  it('sends one email to a user whose IdP email equals the address the sender supplied', async () => {
    const user = await relayedUser(app);
    const audience = {
      kind: 'recipients',
      recipients: [
        {
          kind: 'user',
          issuer: app.issuer.issuer,
          subject: user.subject,
          contactPoints: [{ channel: 'email', address: user.email.toUpperCase() }],
        },
      ],
    };
    const notificationId = await sendNotification(app.t, credential, EMAIL, audience);
    await runWorker(app.t);

    expect(await deliveriesOf(app.t, notificationId)).toMatchObject([{ address: user.email, status: 'delivered' }]);
    expect(messagesTo(app.smtp, user.email)).toBe(1);
  });

  it('sends one email per notification to a mailbox shared by a user and an address-only recipient', async () => {
    const user = await relayedUser(app);
    const audience = {
      kind: 'recipients',
      recipients: [
        { kind: 'user', issuer: app.issuer.issuer, subject: user.subject },
        { kind: 'address', channel: 'email', address: user.email },
      ],
    };
    const notificationId = await sendNotification(app.t, credential, EMAIL, audience);
    await runWorker(app.t);

    expect(await deliveriesOf(app.t, notificationId)).toHaveLength(1);
    expect(messagesTo(app.smtp, user.email)).toBe(1);
  });

  it('still emails an address-only recipient whose mailbox another recipient has not yet confirmed', async () => {
    const shared = 'shared-pending@example.com';
    const user = await relayedUser(app);
    const added = await app.t
      .http()
      .post('/api/v1/me/contact-points')
      .set(user.auth)
      .send({ channel: 'email', address: shared });
    expect(added.status).toBe(201);
    const audience = {
      kind: 'recipients',
      recipients: [
        { kind: 'user', issuer: app.issuer.issuer, subject: user.subject },
        { kind: 'address', channel: 'email', address: shared },
      ],
    };
    const notificationId = await sendNotification(app.t, credential, EMAIL, audience);
    await runWorker(app.t);

    const rows = await deliveriesOf(app.t, notificationId);
    const outcomes = rows
      .map(({ recipientId, address, status, reason }) => ({
        recipient: recipientId === user.recipientId ? 'user' : 'address-only',
        address,
        status,
        reason,
      }))
      .toSorted((a, b) => `${a.address}${a.recipient}`.localeCompare(`${b.address}${b.recipient}`));
    expect(outcomes).toEqual([
      { recipient: 'address-only', address: shared, status: 'delivered', reason: null },
      { recipient: 'user', address: shared, status: 'skipped', reason: 'no usable contact point' },
      { recipient: 'user', address: user.email, status: 'delivered', reason: null },
    ]);
    // The confirmation email and the address-only recipient's notification.
    expect(messagesTo(app.smtp, shared)).toBe(2);
  });

  it('keeps each user’s escalation step to a shared mailbox, so one user’s read cancels only their own', async () => {
    const shared = 'shared-escalation@example.com';
    const [reader, other] = await Promise.all([relayedUser(app), relayedUser(app)]);
    const withShared = (subject: string) => ({
      kind: 'user',
      issuer: app.issuer.issuer,
      subject,
      contactPoints: [{ channel: 'email', address: shared }],
    });
    const audience = { kind: 'recipients', recipients: [withShared(reader.subject), withShared(other.subject)] };
    const notificationId = await sendNotification(app.t, credential, STEPS, audience);
    await runWorker(app.t);
    const sharedStepOne = (await deliveriesOf(app.t, notificationId)).filter(
      (row) => row.step === 1 && row.address === shared,
    );
    expect(sharedStepOne.map((row) => row.recipientId).toSorted()).toEqual(
      [reader.recipientId, other.recipientId].toSorted(),
    );

    const nr = await notificationRecipientId(app.t, notificationId, reader.recipientId);
    await cancelPendingSteps(app.t.database.db, nr, 'read', app.clock.now());
    app.clock.advanceMinutes(10);
    await runWorker(app.t);

    expect(messagesTo(app.smtp, shared)).toBe(1);
    expect(messagesTo(app.smtp, reader.email)).toBe(0);
    expect(messagesTo(app.smtp, other.email)).toBe(1);
  });
});

describe('what each kind of recipient gets (R19, R27, R38, KTD7)', () => {
  it('schedules escalation steps one after another, each from the previous step’s final status (KTD8)', async () => {
    const user = await relayedUser(app);
    const sentAt = app.clock.now().getTime();
    const notificationId = await sendNotification(app.t, credential, STEPS, user.audience);
    await runWorker(app.t);
    expect(await deliveriesOf(app.t, notificationId)).toMatchObject([
      { step: 1, status: 'scheduled', dueAt: new Date(sentAt + 10 * 60_000) },
      { step: 2, status: 'scheduled', dueAt: null },
    ]);

    app.clock.advanceMinutes(10);
    await runWorker(app.t);

    expect(await deliveriesOf(app.t, notificationId)).toMatchObject([
      { step: 1, status: 'delivered' },
      { step: 2, status: 'scheduled', dueAt: new Date(sentAt + 40 * 60_000) },
    ]);
    app.clock.advanceMinutes(30);
    await runWorker(app.t);
    expect(messagesTo(app.smtp, user.email)).toBe(2);
  });

  it('gives an address-only recipient every policy channel at once and no inbox item', async () => {
    const address = 'public-person@example.com';
    const notificationId = await sendNotification(app.t, credential, STEPS, addressAudience(address));
    await runWorker(app.t);

    expect(await deliveriesOf(app.t, notificationId)).toMatchObject([{ step: 0, status: 'delivered', address }]);
    expect(await inboxItemsOf(app.t, notificationId)).toEqual([]);
    expect(messagesTo(app.smtp, address)).toBe(1);
  });

  it('delivers a system its webhook and records the email it cannot have as "no contact point"', async () => {
    const hook = app.receiver.url('/planner/system');
    await registerSystem(app.t, credential, 'planner-system', [hook]);
    const notificationId = await sendNotification(app.t, credential, BOTH, systemAudience('planner-system'));
    await runWorker(app.t);

    const rows = await deliveriesOf(app.t, notificationId);
    const byChannel = rows.toSorted((a, b) => a.channel.localeCompare(b.channel));
    expect(byChannel.map(({ channel, status, reason }) => ({ channel, status, reason }))).toEqual([
      { channel: 'email', status: 'skipped', reason: 'no contact point' },
      { channel: 'webhook', status: 'delivered', reason: null },
    ]);
    expect(await inboxItemsOf(app.t, notificationId)).toEqual([]);
    expect(app.receiver.requestsTo('/planner/system')).toHaveLength(1);
  });

  it('gives a user nobody gave an address the in-app item and records the email as "no contact point" (R27)', async () => {
    const audience = {
      kind: 'recipients',
      recipients: [{ kind: 'user', issuer: app.issuer.issuer, subject: 'never-logged-in' }],
    };
    const notificationId = await sendNotification(app.t, credential, EMAIL, audience);
    await runWorker(app.t);

    expect(await inboxItemsOf(app.t, notificationId)).toHaveLength(1);
    expect(await deliveriesOf(app.t, notificationId)).toMatchObject([
      { status: 'skipped', reason: 'no contact point', contactPointId: null },
    ]);
  });

  it('plans an address still awaiting confirmation, then skips it at claim as "no usable contact point" (AE4)', async () => {
    const user = await relayedUser(app);
    const added = await app.t
      .http()
      .post('/api/v1/me/contact-points')
      .set(user.auth)
      .send({ channel: 'email', address: 'second@example.com' });
    expect(added.status).toBe(201);
    const notificationId = await sendNotification(app.t, credential, EMAIL, user.audience);
    await runWorker(app.t);

    const rows = await deliveriesOf(app.t, notificationId);
    expect(rows.map(({ address, status, reason }) => ({ address, status, reason }))).toEqual([
      { address: 'second@example.com', status: 'skipped', reason: 'no usable contact point' },
      { address: user.email, status: 'delivered', reason: null },
    ]);
    // Only the confirmation email reached the pending address.
    expect(messagesTo(app.smtp, 'second@example.com')).toBe(1);
  });
});

describe('notification variables (R36, KTD10)', () => {
  it('renders the notification id for a user, and leaves the guarded portal link out of an address email', async () => {
    const user = await relayedUser(app);
    const address = 'portal-link-address@example.com';
    const audience = {
      kind: 'recipients',
      recipients: [
        { kind: 'user', issuer: app.issuer.issuer, subject: user.subject },
        { kind: 'address', channel: 'email', address },
      ],
    };
    const notificationId = await sendNotification(app.t, credential, LINKED, audience);
    await runWorker(app.t);

    expect(await inboxItemsOf(app.t, notificationId)).toMatchObject([{ actionUrl: `/inbox/${notificationId}` }]);
    const rows = await deliveriesOf(app.t, notificationId);
    const texts = await Promise.all(
      rows.map(async (row) => {
        const [attempt] = await attemptsOf(app.t, row.id);
        return [row.address, attempt?.rendered?.channel === 'email' ? attempt.rendered.text.trim() : null];
      }),
    );
    expect(Object.fromEntries(texts)).toEqual({
      [address]: 'Open',
      [user.email]: `Open https://portal.example/inbox/${notificationId}`,
    });
  });
});
