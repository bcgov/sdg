import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { verifyWebhook, type WebhookHeaders } from '../crypto/signing.js';
import { failureCallbacks } from '../database/schema/index.js';
import {
  attemptsOf,
  defineDeliveryType,
  deliveriesOf,
  registerSystem,
  relayedUser,
  runWorker,
  sendNotification,
  setCallback,
  startDeliveryApp,
  systemAudience,
  type DeliveryApp,
} from '../testing/delivery.js';
import { integrationPath } from '../testing/integrations.js';
import { bearer } from '../testing/senders.js';
import { sendingSender, type SendingSender } from '../testing/sending.js';
import type { ReceivedWebhook } from '../testing/webhook-receiver.js';

const HOOK = 'failing-hook';
const STEP = 'override-step';

/** The signed headers a request carried. */
const signed = (request: ReceivedWebhook): WebhookHeaders => ({
  'webhook-id': request.headers['webhook-id'] ?? '',
  'webhook-timestamp': request.headers['webhook-timestamp'] ?? '',
  'webhook-signature': request.headers['webhook-signature'] ?? '',
});

describe('retries and failure callbacks (R42, KTD10, KTD17)', () => {
  let app: DeliveryApp;
  let sender: SendingSender;
  let credential: { authorization: string };
  let callbackSecret: string;

  beforeAll(async () => {
    app = await startDeliveryApp();
    await defineDeliveryType(app.t, app.adminToken, {
      key: HOOK,
      policy: { mode: 'all-at-once', channels: ['webhook'] },
      templates: { webhook: ['en-CA'] },
    });
    sender = await sendingSender(app.t, app.issuer, app.adminToken, 'callback-sender', [HOOK]);
    credential = await sender.credential('callback-sender-client', [HOOK]);
    callbackSecret = await setCallback(app.t, sender.id, sender.ownerToken, app.receiver.url('/callback'));
  });

  afterAll(() => app.close());

  it('covers AE11: a webhook failing every attempt fails after 6, backing off, and its callback carries the delivery ID', async () => {
    app.receiver.respond('/always-500', { status: 500 });
    await registerSystem(app.t, credential, 'failing-system', [app.receiver.url('/always-500')]);
    const notificationId = await sendNotification(app.t, credential, HOOK, systemAudience('failing-system'));
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each attempt waits for the previous one's backoff.
      await runWorker(app.t);
      // oxlint-disable-next-line no-await-in-loop -- as above.
      const [row] = await deliveriesOf(app.t, notificationId);
      if (row?.status !== 'scheduled' || !row.dueAt) break;
      waits.push((row.dueAt.getTime() - app.clock.now().getTime()) / 1000);
      app.clock.set(row.dueAt);
    }

    expect(waits).toEqual([30, 60, 120, 240, 480]);
    const [delivery] = await deliveriesOf(app.t, notificationId);
    expect(delivery).toMatchObject({ status: 'failed', reason: 'attempts exhausted', attempts: 6 });
    const attempts = await attemptsOf(app.t, delivery?.id ?? '');
    expect(attempts.map((attempt) => [attempt.attempt, attempt.status, attempt.error])).toEqual(
      [1, 2, 3, 4, 5, 6].map((attempt) => [attempt, 'failed', 'HTTP 500']),
    );
    expect(app.receiver.requestsTo('/always-500')).toHaveLength(6);
    const [callback] = app.receiver.requestsTo('/callback');
    expect(app.receiver.requestsTo('/callback')).toHaveLength(1);
    if (!callback) throw new Error('No callback was sent');
    expect(callback.headers['webhook-id']).toBe(delivery?.id);
    expect(verifyWebhook({ secret: callbackSecret, headers: signed(callback), body: callback.body })).toBe(true);
    expect(JSON.parse(callback.body)).toEqual({
      type: 'delivery.failed',
      deliveryId: delivery?.id,
      notificationId,
      notificationType: HOOK,
      recipientId: delivery?.recipientId,
      channel: 'webhook',
      reason: 'attempts exhausted',
      attempts: 6,
    });
  });

  it('retries a failed callback with the same delivery ID', async () => {
    app.receiver.respond('/rejects', { status: 400 });
    app.receiver.respond('/callback', { status: 503 });
    await registerSystem(app.t, credential, 'rejecting-system', [app.receiver.url('/rejects')]);
    const before = app.receiver.requestsTo('/callback').length;
    const notificationId = await sendNotification(app.t, credential, HOOK, systemAudience('rejecting-system'));
    await runWorker(app.t);
    const [delivery] = await deliveriesOf(app.t, notificationId);
    // A 400 can't pass on a retry: the delivery fails at once.
    expect(delivery).toMatchObject({ status: 'failed', reason: 'permanent failure', attempts: 1 });

    app.receiver.respond('/callback', { status: 204 });
    app.clock.advanceMs(30_000);
    await runWorker(app.t);

    const calls = app.receiver.requestsTo('/callback').slice(before);
    expect(calls.map((call) => call.headers['webhook-id'])).toEqual([delivery?.id, delivery?.id]);
    const [row] = await app.t.database.db
      .select()
      .from(failureCallbacks)
      .where(eq(failureCallbacks.deliveryId, delivery?.id ?? ''));
    expect(row).toMatchObject({ status: 'delivered', attempts: 2, lastError: null });
  });
});

describe('no usable integration (KTD9)', () => {
  let app: DeliveryApp;

  beforeAll(async () => {
    // No platform email default: email works only through a sender's own integration.
    app = await startDeliveryApp({ platformEmail: false });
    await defineDeliveryType(app.t, app.adminToken, {
      key: STEP,
      policy: { mode: 'escalation', steps: [{ channel: 'email', delayMinutes: 15 }] },
    });
  });

  afterAll(() => app.close());

  it('fails an escalation step whose integration override was deleted without retrying, and fires the callback', async () => {
    const sender = await sendingSender(app.t, app.issuer, app.adminToken, 'override-sender', [STEP]);
    await sender.overrideEmail();
    const credential = await sender.credential('override-sender-client', [STEP]);
    await setCallback(app.t, sender.id, sender.ownerToken, app.receiver.url('/override-callback'));
    const user = await relayedUser(app);
    const notificationId = await sendNotification(app.t, credential, STEP, user.audience);
    await runWorker(app.t);

    const deleted = await app.t.http().delete(integrationPath(sender.id, 'email')).set(bearer(sender.ownerToken));
    expect(deleted.status).toBe(204);
    app.clock.advanceMinutes(15);
    await runWorker(app.t);

    const [delivery] = await deliveriesOf(app.t, notificationId);
    expect(delivery).toMatchObject({ status: 'failed', reason: 'no usable integration', attempts: 1 });
    expect(await attemptsOf(app.t, delivery?.id ?? '')).toMatchObject([
      { status: 'failed', integrationId: null, error: 'no usable integration', rendered: { channel: 'email' } },
    ]);
    const calls = app.receiver.requestsTo('/override-callback');
    expect(calls.map((call) => call.headers['webhook-id'])).toEqual([delivery?.id]);
  });
});
