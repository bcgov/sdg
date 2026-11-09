import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  defineDeliveryType,
  inboxItemsOf,
  relayedUser,
  runWorker,
  sendNotification,
  startDeliveryApp,
  type DeliveryApp,
  type RelayedUser,
} from '../../testing/delivery.js';
import { sendingSender } from '../../testing/sending.js';
import { settleSignals, watchSignals } from '../../testing/signals.js';
import { INBOX_SIGNALS, InboxSubscribers, type InboxSignals } from './inbox-signals.js';

const TYPE = 'signals-escalating';
const INBOX = '/api/v1/me/inbox';

let app: DeliveryApp;
let signals: InboxSignals;
let credential: { authorization: string };

beforeAll(async () => {
  app = await startDeliveryApp();
  await defineDeliveryType(app.t, app.adminToken, {
    key: TYPE,
    policy: { mode: 'escalation', steps: [{ channel: 'email', delayMinutes: 60 }] },
  });
  const sender = await sendingSender(app.t, app.issuer, app.adminToken, 'signals-sender', [TYPE]);
  credential = await sender.credential('signals-sender-client', [TYPE]);
  signals = app.t.app.get<InboxSignals>(INBOX_SIGNALS);
});

afterAll(() => app.close());

const watch = (recipientId: string) => watchSignals(signals, recipientId);
const settle = () => settleSignals(signals, app.t.database.db);

/** Sends to the user and plans it; resolves the inbox item ids. */
async function sendTo(user: RelayedUser, count = 1): Promise<string[]> {
  const sends = Array.from({ length: count }, () => sendNotification(app.t, credential, TYPE, user.audience));
  const notificationIds = await Promise.all(sends);
  await runWorker(app.t);
  const items = await Promise.all(notificationIds.map((id) => inboxItemsOf(app.t, id)));
  return items.flat().map((item) => item.id);
}

describe('inbox change signals (KTD3)', () => {
  it('signals the recipient once the worker commits a new notification’s inbox item', async () => {
    const user = await relayedUser(app);
    const watcher = watch(user.recipientId);
    await sendNotification(app.t, credential, TYPE, user.audience);
    await settle();
    expect(watcher.count()).toBe(0);

    await runWorker(app.t);
    await settle();

    expect(watcher.count()).toBe(1);
    watcher.unsubscribe();
  });

  it('signals the recipient when they read an item', async () => {
    const user = await relayedUser(app);
    const [itemId] = await sendTo(user);
    const watcher = watch(user.recipientId);

    const res = await app.t
      .http()
      .post(`${INBOX}/${itemId ?? ''}/read`)
      .set(user.auth);
    await settle();

    expect(res.status).toBe(200);
    expect(watcher.count()).toBe(1);
    watcher.unsubscribe();
  });

  it('signals the recipient once for mark all as read, however many items it marks', async () => {
    const user = await relayedUser(app);
    await sendTo(user, 3);
    const watcher = watch(user.recipientId);

    const res = await app.t.http().post(`${INBOX}/read-all`).set(user.auth);
    await settle();

    expect(res.body).toEqual({ marked: 3 });
    expect(watcher.count()).toBe(1);
    watcher.unsubscribe();
  });

  it('sends another recipient’s subscriber nothing, and an unsubscribed one nothing', async () => {
    const user = await relayedUser(app);
    const other = await relayedUser(app);
    const others = watch(other.recipientId);
    const gone = watch(user.recipientId);
    gone.unsubscribe();

    await sendTo(user);
    await app.t.http().post(`${INBOX}/read-all`).set(user.auth);
    await settle();

    expect(others.count()).toBe(0);
    expect(gone.count()).toBe(0);
    others.unsubscribe();
  });
});

describe('dispatching to subscribers', () => {
  it('logs a subscriber that throws and still reaches the others', () => {
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const subscribers = new InboxSubscribers();
    const reached: string[] = [];
    subscribers.subscribe('recipient-1', () => {
      throw new Error('write failed');
    });
    subscribers.subscribe('recipient-1', () => reached.push('dispatch'));

    subscribers.dispatch('recipient-1');
    subscribers.broadcast();

    expect(reached).toEqual(['dispatch', 'dispatch']);
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'recipient-1',
        error: expect.objectContaining({ message: 'write failed' }),
      }),
    );
    errors.mockRestore();
  });
});
