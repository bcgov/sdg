import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { notificationRecipients, notifications } from '../database/schema/index.js';
import {
  defineDeliveryType,
  registerSystem,
  relayedUser,
  runWorker,
  sendNotification,
  startDeliveryApp,
  systemAudience,
  type DeliveryApp,
  type RelayedUser,
} from '../testing/delivery.js';
import { addressAudience, sendingSender } from '../testing/sending.js';

const TYPE = 'broadcast-alert';

let app: DeliveryApp;

beforeAll(async () => {
  app = await startDeliveryApp();
  await defineDeliveryType(app.t, app.adminToken, { key: TYPE, policy: { mode: 'all-at-once', channels: ['email'] } });
});

afterAll(() => app.close());

/** A sender of TYPE with one self-subscribe topic of its own. */
async function senderWithTopic(name: string) {
  const sender = await sendingSender(app.t, app.issuer, app.adminToken, name, [TYPE]);
  const credential = await sender.credential(`${name}-client`, [TYPE]);
  const topic = await app.t
    .http()
    .post('/api/v1/topics')
    .set(credential)
    .send({ key: `${name}-news`, name: 'News', selfSubscribe: true });
  expect(topic.status).toBe(201);
  return { credential, topicId: String(topic.body.id) };
}

const subscribe = (user: RelayedUser, topicId: string) =>
  app.t.http().put(`/api/v1/me/subscriptions/${topicId}`).set(user.auth);

/** The notification's expanded recipients, sorted. */
async function audienceOf(notificationId: string): Promise<string[]> {
  const rows = await app.t.database.db
    .select({ recipientId: notificationRecipients.recipientId })
    .from(notificationRecipients)
    .where(eq(notificationRecipients.notificationId, notificationId));
  return rows.map((row) => row.recipientId).toSorted((a, b) => a.localeCompare(b));
}

describe('expanding audiences (R30, R31, KTD14)', () => {
  it('covers AE12: "everyone" reaches registered users, systems and topic subscribers, not address-only recipients, and is fixed at expansion', async () => {
    const { credential, topicId } = await senderWithTopic('everyone-sender');
    const [registered, subscriber, late] = await Promise.all([relayedUser(app), relayedUser(app), relayedUser(app)]);
    await sendNotification(app.t, credential, TYPE, registered.audience);
    const addressOnly = await sendNotification(app.t, credential, TYPE, addressAudience('public@example.com'));
    await registerSystem(app.t, credential, 'everyone-system', [app.receiver.url('/everyone')]);
    const systemSend = await sendNotification(app.t, credential, TYPE, systemAudience('everyone-system'));
    expect((await subscribe(subscriber, topicId)).status).toBe(204);
    await runWorker(app.t);
    const [[addressRecipient], [system]] = await Promise.all([audienceOf(addressOnly), audienceOf(systemSend)]);

    const everyone = await sendNotification(app.t, credential, TYPE, { kind: 'everyone' });
    await runWorker(app.t);
    expect((await subscribe(late, topicId)).status).toBe(204);
    await runWorker(app.t);

    const audience = await audienceOf(everyone);
    expect(audience).toEqual(
      [registered.recipientId, subscriber.recipientId, system].toSorted((a, b) => (a ?? '').localeCompare(b ?? '')),
    );
    expect(audience).not.toContain(addressRecipient);
    expect(audience).not.toContain(late.recipientId);
    const [stored] = await app.t.database.db.select().from(notifications).where(eq(notifications.id, everyone));
    expect(stored).toMatchObject({ status: 'expanded', expandedAt: app.clock.now() });
  });

  it('covers AE14: a user who unsubscribed from the sender’s only topic is not reached by its next "everyone" send', async () => {
    const { credential, topicId } = await senderWithTopic('unsubscribed-sender');
    const [leaver, stayer] = await Promise.all([relayedUser(app), relayedUser(app)]);
    expect((await subscribe(leaver, topicId)).status).toBe(204);
    expect((await subscribe(stayer, topicId)).status).toBe(204);
    const unsubscribed = await app.t.http().delete(`/api/v1/me/subscriptions/${topicId}`).set(leaver.auth);
    expect(unsubscribed.status).toBe(204);

    const everyone = await sendNotification(app.t, credential, TYPE, { kind: 'everyone' });
    await runWorker(app.t);

    expect(await audienceOf(everyone)).toEqual([stayer.recipientId]);
  });

  it('reaches only the topic’s current subscribers for a topic send', async () => {
    const { credential, topicId } = await senderWithTopic('topic-sender');
    const [subscriber, registered] = await Promise.all([relayedUser(app), relayedUser(app)]);
    expect((await subscribe(subscriber, topicId)).status).toBe(204);
    await sendNotification(app.t, credential, TYPE, registered.audience);

    const topicSend = await sendNotification(app.t, credential, TYPE, { kind: 'topic', topicId });
    await runWorker(app.t);

    expect(await audienceOf(topicSend)).toEqual([subscriber.recipientId]);
  });

  it('adds no duplicate recipients when a notification is expanded again after a crash', async () => {
    const { credential } = await senderWithTopic('crash-sender');
    const user = await relayedUser(app);
    const audience = {
      kind: 'recipients',
      recipients: [
        { kind: 'user', issuer: app.issuer.issuer, subject: user.subject },
        { kind: 'address', channel: 'email', address: 'crash@example.com' },
      ],
    };
    const notificationId = await sendNotification(app.t, credential, TYPE, audience);
    await runWorker(app.t);
    const first = await audienceOf(notificationId);

    // As if the worker died after the audience was inserted but before the notification was marked expanded.
    await app.t.database.db
      .update(notifications)
      .set({ status: 'accepted', expandedAt: null })
      .where(eq(notifications.id, notificationId));
    await runWorker(app.t);

    expect(first).toHaveLength(2);
    expect(await audienceOf(notificationId)).toEqual(first);
  });
});
