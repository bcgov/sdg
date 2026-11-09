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
import { sendingSender } from '../testing/sending.js';

const ESCALATING = 'read-all-escalating';
const INBOX = '/api/v1/me/inbox';

let app: DeliveryApp;
let credential: { authorization: string };

beforeAll(async () => {
  app = await startDeliveryApp();
  await defineDeliveryType(app.t, app.adminToken, {
    key: ESCALATING,
    policy: { mode: 'escalation', steps: [{ channel: 'email', delayMinutes: 60 }] },
  });
  const sender = await sendingSender(app.t, app.issuer, app.adminToken, 'read-all-sender', [ESCALATING]);
  credential = await sender.credential('read-all-sender-client', [ESCALATING]);
});

afterAll(() => app.close());

/** Sends the escalating type to the user `count` times and plans it all; resolves the notification ids. */
async function sendTo(user: RelayedUser, count = 1): Promise<string[]> {
  const sends = Array.from({ length: count }, () => sendNotification(app.t, credential, ESCALATING, user.audience));
  const notificationIds = await Promise.all(sends);
  await runWorker(app.t);
  return notificationIds;
}

const readAll = (user: RelayedUser) => app.t.http().post(`${INBOX}/read-all`).set(user.auth);

describe('marking all as read (R20, KTD9)', () => {
  it('covers AE5: reads all 45 unread items, loaded or not, and cancels each pending reminder', async () => {
    const user = await relayedUser(app);
    const notificationIds = await sendTo(user, 45);
    const popover = await app.t.http().get(`${INBOX}?limit=20`).set(user.auth);
    expect(popover.body.items).toHaveLength(20);
    app.clock.advanceMinutes(10);
    const readAt = app.clock.now();

    const res = await readAll(user);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ marked: 45 });
    const count = await app.t.http().get(`${INBOX}/unread-count`).set(user.auth);
    expect(count.body).toEqual({ unread: 0 });
    const items = await Promise.all(notificationIds.map((id) => inboxItemsOf(app.t, id)));
    expect(items.flat().map((item) => item.readAt)).toEqual(notificationIds.map(() => readAt));
    const reminders = await Promise.all(notificationIds.map((id) => deliveriesOf(app.t, id)));
    expect(reminders.flat()).toHaveLength(45);
    for (const reminder of reminders.flat()) {
      expect(reminder).toMatchObject({ step: 1, status: 'cancelled', reason: 'read in app' });
    }
  });

  it('keeps an already-read item’s first read time and counts only the items it marked', async () => {
    const user = await relayedUser(app);
    const [earlier, later] = await sendTo(user, 2);
    const [earlierItem] = await inboxItemsOf(app.t, earlier ?? '');
    const firstRead = app.clock.now();
    await app.t
      .http()
      .post(`${INBOX}/${earlierItem?.id ?? ''}/read`)
      .set(user.auth);
    app.clock.advanceMinutes(5);

    const res = await readAll(user);

    expect(res.body).toEqual({ marked: 1 });
    expect(await inboxItemsOf(app.t, earlier ?? '')).toMatchObject([{ readAt: firstRead }]);
    expect(await inboxItemsOf(app.t, later ?? '')).toMatchObject([{ readAt: app.clock.now() }]);
    const again = await readAll(user);
    expect(again.body).toEqual({ marked: 0 });
  });

  it('leaves another recipient’s items unread and their reminders scheduled', async () => {
    const reader = await relayedUser(app);
    const other = await relayedUser(app);
    const [, othersNotification] = [...(await sendTo(reader)), ...(await sendTo(other))];

    const res = await readAll(reader);

    expect(res.body).toEqual({ marked: 1 });
    expect(await inboxItemsOf(app.t, othersNotification ?? '')).toMatchObject([{ readAt: null }]);
    expect(await deliveriesOf(app.t, othersNotification ?? '')).toMatchObject([{ step: 1, status: 'scheduled' }]);
  });
});
