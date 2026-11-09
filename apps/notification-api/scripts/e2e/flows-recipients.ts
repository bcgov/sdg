// F3 (portal user manages contact points) and F1 (direct send with escalation), through portal-api's relay.
import { z } from 'zod';

import { TYPE_KEYS } from '../lib/catalog.ts';
import { expectBody, expectStatus, type Api } from '../lib/http.ts';
import type { MailSummary, Mailpit } from './catchers.ts';
import { ESCALATION_DELAY_MINUTES, type E2eContext } from './context.ts';
import { deliveryOn, send, settled, to } from './notifications.ts';
import { check, sleep, waitFor } from './support.ts';

const pointSchema = z.object({ id: z.uuid(), address: z.string(), verified: z.boolean() });
const inboxSchema = z.object({ items: z.array(z.object({ id: z.uuid(), notificationId: z.uuid() })) });

/** Waits for a message to `address` whose subject contains `text`. */
export function mailTo(mailpit: Mailpit, address: string, text: string, timeoutMs?: number): Promise<MailSummary> {
  return waitFor(
    `an email to ${address} about ${text}`,
    async () => (await mailpit.messagesTo(address)).find((message) => message.Subject.includes(text)),
    timeoutMs === undefined ? {} : { timeoutMs },
  );
}

/** The confirm token from the confirmation email's link (KTD15). */
async function confirmToken(ctx: E2eContext, address: string): Promise<string> {
  const message = await mailTo(ctx.mailpit, address, 'Confirm your email address');
  const token = /confirm-email\?token=([^\s"&<>]+)/.exec(await ctx.mailpit.text(message.ID))?.[1];
  if (token === undefined) throw new Error('The confirmation email has no confirm-email link');
  return decodeURIComponent(token);
}

async function contactPoint(portal: Api, address: string): Promise<z.infer<typeof pointSchema> | undefined> {
  const reply = await portal.call('GET', '/api/v1/notifications/contact-points');
  return expectBody(reply, 'Listing contact points', z.array(pointSchema)).find((point) => point.address === address);
}

/** F3: a second address is stored unverified, confirmed through the emailed link, then receives email deliveries. */
export async function portalContactPoints(ctx: E2eContext): Promise<void> {
  const address = `f3-${ctx.run}@example.test`;
  const added = await ctx.portal.call('POST', '/api/v1/notifications/contact-points', { channel: 'email', address });
  check(
    !expectBody(added, 'Adding a contact point', pointSchema).verified,
    'A new address is verified before confirming',
  );
  const token = await confirmToken(ctx, address);
  expectStatus(await ctx.portal.call('POST', '/api/v1/contact-points/confirm', { token }), 'Confirming', [204]);
  check((await contactPoint(ctx.portal, address))?.verified === true, 'The address is not verified after confirming');

  const permitNumber = `F3-${ctx.run}`;
  await send(ctx.notify.a, {
    type: TYPE_KEYS.permitStatus,
    data: { permitNumber, status: 'issued' },
    idempotencyKey: `f3-${ctx.run}`,
    audience: to({ kind: 'user', ...ctx.me }),
  });
  await mailTo(ctx.mailpit, address, permitNumber);
}

async function inboxItemFor(portal: Api, notificationId: string): Promise<string> {
  return waitFor(`the in-app item of ${notificationId} in the portal inbox`, async () => {
    const reply = await portal.call('GET', '/api/v1/notifications/inbox?limit=100');
    const { items } = expectBody(reply, 'Reading the inbox', inboxSchema);
    return items.find((item) => item.notificationId === notificationId)?.id;
  });
}

/** F1: in-app first; reading it cancels the email step, leaving it unread lets the email go after the delay. */
export async function directSendWithEscalation(ctx: E2eContext): Promise<void> {
  const sendPermit = (permitNumber: string) =>
    send(ctx.notify.a, {
      type: TYPE_KEYS.permitApproved,
      data: { permitNumber },
      idempotencyKey: `f1-${permitNumber}`,
      audience: to({ kind: 'user', ...ctx.me }),
    });
  const [readPermit, unreadPermit] = [`F1R-${ctx.run}`, `F1U-${ctx.run}`];
  const [readId, unreadId] = await Promise.all([sendPermit(readPermit), sendPermit(unreadPermit)]);
  const [readItem] = await Promise.all([inboxItemFor(ctx.portal, readId), inboxItemFor(ctx.portal, unreadId)]);
  const read = await ctx.portal.call('POST', `/api/v1/notifications/inbox/${readItem}/read`);
  expectStatus(read, 'Marking the in-app item read', [200]);

  const delayMs = ESCALATION_DELAY_MINUTES * 60_000;
  await mailTo(ctx.mailpit, ctx.idpEmail, unreadPermit, delayMs + 60_000);
  const unread = deliveryOn(await settled(ctx.notify.a, unreadId), 'email', ctx.idpEmail);
  check(unread.status === 'delivered', `The unread item's email step is ${unread.status}`);
  const cancelled = await settled(ctx.notify.a, readId);
  check(
    cancelled.deliveries.every((delivery) => delivery.status === 'cancelled'),
    `The read item's email steps are ${cancelled.deliveries.map((d) => d.status).join(', ')}, not cancelled`,
  );
  // The read item's step was due at the same time as the unread one's; give a wrongly sent email time to land.
  await sleep(5000);
  const sent = await ctx.mailpit.messagesTo(ctx.idpEmail);
  check(!sent.some((message) => message.Subject.includes(readPermit)), 'The read item was emailed anyway');
}
