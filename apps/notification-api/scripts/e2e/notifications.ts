// Sending and reading history as a sender credential, for scripts/e2e.ts.
import { z } from 'zod';

import { expectBody, type Api } from '../lib/http.ts';
import { waitFor, type WaitOptions } from './support.ts';

export type SendRecipient =
  | { kind: 'user'; issuer: string; subject: string }
  | { kind: 'system'; systemId: string }
  | { kind: 'address'; channel: 'email'; address: string; language?: string; reference?: string };

export type Audience = { kind: 'recipients'; recipients: SendRecipient[] } | { kind: 'topic'; topicId: string };

export interface SendBody {
  type: string;
  data: Record<string, unknown>;
  idempotencyKey: string;
  audience: Audience;
}

const acceptedSchema = z.object({ notificationId: z.uuid() });

/** Sends and returns the notification id; anything but 202 throws. */
export async function send(credential: Api, body: SendBody): Promise<string> {
  const reply = await credential.call('POST', '/api/v1/notifications', body);
  return expectBody(reply, `Sending ${body.type}`, acceptedSchema, [202]).notificationId;
}

export const to = (...recipients: SendRecipient[]): Audience => ({ kind: 'recipients', recipients });

const FINAL = new Set(['delivered', 'failed', 'cancelled', 'skipped']);

const deliverySchema = z.object({
  id: z.uuid(),
  channel: z.string(),
  status: z.string(),
  address: z.string().nullable(),
  attempts: z.array(z.object({ integrationId: z.string().nullable(), status: z.string() })),
});
export type Delivery = z.infer<typeof deliverySchema>;

const detailSchema = z.object({
  id: z.uuid(),
  status: z.string(),
  deliveries: z.array(deliverySchema),
  inboxItems: z.array(z.object({ id: z.uuid(), readAt: z.string().nullable() })),
});
export type NotificationDetail = z.infer<typeof detailSchema>;

export async function detail(credential: Api, notificationId: string): Promise<NotificationDetail> {
  const reply = await credential.call('GET', `/api/v1/notifications/${notificationId}`);
  return expectBody(reply, 'Reading notification history', detailSchema);
}

/** The history once the notification is expanded and `done` holds for its deliveries (default: all final). */
export function settled(
  credential: Api,
  notificationId: string,
  done: (deliveries: Delivery[]) => boolean = (deliveries) => deliveries.every((d) => FINAL.has(d.status)),
  options?: WaitOptions,
): Promise<NotificationDetail> {
  return waitFor(
    `notification ${notificationId} to settle`,
    async () => {
      const found = await detail(credential, notificationId);
      return found.status === 'expanded' && found.deliveries.length > 0 && done(found.deliveries) ? found : undefined;
    },
    options,
  );
}

const pageSchema = z.object({ items: z.array(z.object({ id: z.uuid() })) });

/** The ids of the sender's notifications matching a history filter (R43). */
export async function historyIds(credential: Api, filter: Record<string, string>): Promise<string[]> {
  const query = new URLSearchParams({ ...filter, limit: '100' });
  const reply = await credential.call('GET', `/api/v1/notifications?${query.toString()}`);
  return expectBody(reply, 'Searching history', pageSchema).items.map((item) => item.id);
}

/** The delivery on `channel` (the first when there are several), or throws. */
export function deliveryOn(found: NotificationDetail, channel: string, address?: string): Delivery {
  const delivery = found.deliveries.find(
    (d) => d.channel === channel && (address === undefined || d.address === address),
  );
  if (!delivery)
    throw new Error(`Notification ${found.id} has no ${channel} delivery${address ? ` to ${address}` : ''}`);
  return delivery;
}
