// F6 (topic broadcast): a sender topic with two subscribers the sender added, and the seeded platform topic the
// portal user subscribes to themselves.
import { z } from 'zod';

import { TYPE_KEYS } from '../lib/catalog.ts';
import { expectBody, expectStatus, type Api } from '../lib/http.ts';
import type { E2eContext } from './context.ts';
import { deliveryOn, send, settled } from './notifications.ts';
import { check, waitFor } from './support.ts';

const idSchema = z.object({ id: z.uuid() });
const inboxSchema = z.object({ items: z.array(z.object({ notificationId: z.uuid() })) });

/** Registers one of the sender's systems with a webhook to the receiver under `path`. */
export async function registerSystem(credential: Api, systemId: string, webhookUrl: string): Promise<void> {
  const reply = await credential.call('POST', '/api/v1/recipients/systems', { systemId, webhookUrls: [webhookUrl] });
  expectStatus(reply, `Registering system ${systemId}`);
}

async function senderTopicWithSubscribers(ctx: E2eContext, systemId: string): Promise<string> {
  const reply = await ctx.notify.a.call('POST', '/api/v1/topics', {
    key: `permit-${ctx.run}`,
    name: `Permit ${ctx.run}`,
  });
  const { id } = expectBody(reply, 'Creating the sender topic', idSchema);
  const subscribe = async (ref: object, what: string) =>
    expectStatus(await ctx.notify.a.call('POST', `/api/v1/topics/${id}/subscribers`, ref), what, [204]);
  await Promise.all([
    subscribe(ctx.me, 'Subscribing the portal user'),
    subscribe({ systemId }, 'Subscribing the system'),
  ]);
  return id;
}

function broadcast(ctx: E2eContext, topicId: string, permitNumber: string): Promise<string> {
  return send(ctx.notify.a, {
    type: TYPE_KEYS.permitStatus,
    data: { permitNumber, status: 'broadcast' },
    idempotencyKey: `f6-${permitNumber}`,
    audience: { kind: 'topic', topicId },
  });
}

/** F6: each topic's subscribers get the broadcast on their policy channels (in-app and email; webhook for systems). */
export async function topicBroadcast(ctx: E2eContext): Promise<void> {
  const systemId = `board-${ctx.run}`;
  const hookPath = `/f6/${ctx.run}`;
  await registerSystem(ctx.notify.a, systemId, `${ctx.receiverInternalUrl}${hookPath}`);
  const [senderTopic, subscribed] = await Promise.all([
    senderTopicWithSubscribers(ctx, systemId),
    ctx.portal.call('PUT', `/api/v1/notifications/subscriptions/${ctx.seeded.platformTopicId}`),
  ]);
  expectStatus(subscribed, 'Subscribing to the platform topic through the portal', [204]);

  const [senderPermit, platformPermit] = [`F6S-${ctx.run}`, `F6P-${ctx.run}`];
  const [senderSend, platformSend] = await Promise.all([
    broadcast(ctx, senderTopic, senderPermit),
    broadcast(ctx, ctx.seeded.platformTopicId, platformPermit),
  ]);
  const [senderDetail, platformDetail] = await Promise.all([
    settled(ctx.notify.a, senderSend),
    settled(ctx.notify.a, platformSend),
  ]);
  check(deliveryOn(senderDetail, 'webhook').status === 'delivered', 'The sender topic webhook was not delivered');
  check(deliveryOn(senderDetail, 'email', ctx.idpEmail).status === 'delivered', 'The sender topic email failed');
  check(deliveryOn(platformDetail, 'email', ctx.idpEmail).status === 'delivered', 'The platform topic email failed');
  check(!platformDetail.deliveries.some((d) => d.channel === 'webhook'), 'The platform topic reached a non-subscriber');

  const mails = await ctx.mailpit.messagesTo(ctx.idpEmail);
  const emailed = (permit: string) => mails.some((message) => message.Subject.includes(permit));
  check(emailed(senderPermit) && emailed(platformPermit), 'Mailpit is missing a broadcast email');
  const hooks = await ctx.receiver.requests(hookPath);
  check(
    hooks.length === 1 && hooks[0]?.body.includes(senderPermit) === true,
    `The system got ${hooks.length} webhooks`,
  );
  await waitFor('both broadcasts in the portal inbox', async () => {
    const reply = await ctx.portal.call('GET', '/api/v1/notifications/inbox?limit=100');
    const { items } = expectBody(reply, 'Reading the inbox', inboxSchema);
    const ids = new Set(items.map((item) => item.notificationId));
    return ids.has(senderSend) && ids.has(platformSend) ? true : undefined;
  });
}
