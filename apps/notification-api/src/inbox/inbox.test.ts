import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  defineDeliveryType,
  deliveriesOf,
  inboxItemsOf,
  relayedUser,
  runWorker,
  sendNotification,
  startDeliveryApp,
  type DeliveryApp,
  type RelayedUser,
} from '../testing/delivery.js';
import { messagesTo } from '../testing/recipients.js';
import { sendingSender } from '../testing/sending.js';

const ESCALATING = 'inbox-escalating';
const INBOX = '/api/v1/me/inbox';

let app: DeliveryApp;
let credential: { authorization: string };

beforeAll(async () => {
  app = await startDeliveryApp();
  await defineDeliveryType(app.t, app.adminToken, {
    key: ESCALATING,
    policy: { mode: 'escalation', steps: [{ channel: 'email', delayMinutes: 60 }] },
  });
  const sender = await sendingSender(app.t, app.issuer, app.adminToken, 'inbox-sender', [ESCALATING]);
  credential = await sender.credential('inbox-sender-client', [ESCALATING]);
});

afterAll(() => app.close());

/** Sends the escalating type to the user, plans it, and returns the notification and its inbox item ids. */
async function sendTo(user: RelayedUser): Promise<{ notificationId: string; itemId: string }> {
  const notificationId = await sendNotification(app.t, credential, ESCALATING, user.audience);
  await runWorker(app.t);
  const [item] = await inboxItemsOf(app.t, notificationId);
  if (!item) throw new Error('No inbox item was created');
  return { notificationId, itemId: item.id };
}

describe('listing the inbox (R50)', () => {
  it('lists the user’s own items newest first, with their read and acknowledged state, a page at a time', async () => {
    const user = await relayedUser(app);
    const sent: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each item is created a minute after the last.
      sent.push((await sendTo(user)).itemId);
      app.clock.advanceMinutes(1);
    }
    const page1 = await app.t.http().get(`${INBOX}?limit=2`).set(user.auth);
    expect(page1.status).toBe(200);
    expect(page1.body.items).toMatchObject([
      { id: sent[2], type: ESCALATING, title: 'Alert R-1', body: expect.stringContaining('<strong>R-1</strong>') },
      { id: sent[1], readAt: null, acknowledgedAt: null },
    ]);

    const page2 = await app.t
      .http()
      .get(`${INBOX}?limit=2&cursor=${String(page1.body.nextCursor)}`)
      .set(user.auth);
    expect(page2.body).toMatchObject({ items: [{ id: sent[0] }], nextCursor: null });
  });
});

describe('reading and acknowledging (R18, R50)', () => {
  it('marking an item read sets its read time once and cancels the pending email step', async () => {
    const user = await relayedUser(app);
    const { notificationId, itemId } = await sendTo(user);
    app.clock.advanceMinutes(20);
    const readAt = app.clock.now().toISOString();

    const read = await app.t.http().post(`${INBOX}/${itemId}/read`).set(user.auth);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ id: itemId, readAt, acknowledgedAt: null });
    expect(await deliveriesOf(app.t, notificationId)).toMatchObject([
      { step: 1, status: 'cancelled', reason: 'read in app' },
    ]);

    app.clock.advanceMinutes(5);
    const again = await app.t.http().post(`${INBOX}/${itemId}/read`).set(user.auth);
    expect(again.body).toMatchObject({ readAt });
    app.clock.advanceMinutes(45);
    await runWorker(app.t);
    expect(messagesTo(app.smtp, user.email)).toBe(0);
  });

  it('acknowledging an item marks it read and acknowledged and cancels the pending email step', async () => {
    const user = await relayedUser(app);
    const { notificationId, itemId } = await sendTo(user);
    const at = app.clock.now().toISOString();

    const acknowledged = await app.t.http().post(`${INBOX}/${itemId}/acknowledge`).set(user.auth);
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body).toMatchObject({ id: itemId, readAt: at, acknowledgedAt: at });
    expect(await deliveriesOf(app.t, notificationId)).toMatchObject([
      { step: 1, status: 'cancelled', reason: 'acknowledged in app' },
    ]);
    const listed = await app.t.http().get(INBOX).set(user.auth);
    expect(listed.body.items).toMatchObject([{ id: itemId, readAt: at, acknowledgedAt: at }]);
  });

  it('gives another user 404 for the item and leaves it unread and its step pending', async () => {
    const owner = await relayedUser(app);
    const stranger = await relayedUser(app);
    const { notificationId, itemId } = await sendTo(owner);

    const [read, acknowledged, listed] = await Promise.all([
      app.t.http().post(`${INBOX}/${itemId}/read`).set(stranger.auth),
      app.t.http().post(`${INBOX}/${itemId}/acknowledge`).set(stranger.auth),
      app.t.http().get(INBOX).set(stranger.auth),
    ]);
    expect([read.status, acknowledged.status]).toEqual([404, 404]);
    expect(listed.body.items).toEqual([]);
    expect(await inboxItemsOf(app.t, notificationId)).toMatchObject([{ readAt: null, acknowledgedAt: null }]);
    expect(await deliveriesOf(app.t, notificationId)).toMatchObject([{ step: 1, status: 'scheduled' }]);
  });
});
