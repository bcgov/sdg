import { z } from 'zod';

import { POLICY_CHANNELS } from '../catalog/policy.js';
import { DELIVERY_STATUSES } from '../database/schema/deliveries.js';
import { AUDIENCE_KINDS, NOTIFICATION_STATUSES } from '../database/schema/notifications.js';

export const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/** A cursor page's query: the previous page's `nextCursor`, and how many items to return. */
export const pageQuerySchema = z.object({
  cursor: z.uuid().optional().meta({ description: "The previous page's `nextCursor`" }),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

/** Every filter given must match (R43). */
export const historyQuerySchema = pageQuerySchema.extend({
  recipientId: z.uuid().optional().meta({ description: 'A recipient the notification went to' }),
  address: z
    .string()
    .min(1)
    .max(2048)
    .optional()
    .meta({ description: 'An address delivered to, or of an address-only recipient; normalized before matching' }),
  channel: z.enum(POLICY_CHANNELS).default('email').meta({ description: "The address's channel" }),
  reference: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .meta({ description: "The sender's reference on an address-only recipient, such as a form id (F2)" }),
});
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export const notificationParamsSchema = z.object({ notificationId: z.uuid() });
export type NotificationParams = z.infer<typeof notificationParamsSchema>;

/** A notification's deliveries counted by status (R55). */
const count = z.number().int();
export const rollUpSchema = z.object({
  total: count,
  scheduled: count,
  sending: count,
  delivered: count,
  failed: count,
  cancelled: count,
  skipped: count,
}) satisfies z.ZodType<Record<(typeof DELIVERY_STATUSES)[number], number>>;
export type RollUp = z.infer<typeof rollUpSchema>;

export const notificationSummarySchema = z.object({
  id: z.uuid(),
  senderId: z.uuid(),
  /** Null once the credential that sent it was unlinked. */
  credentialId: z.uuid().nullable(),
  type: z.string(),
  audienceKind: z.enum(AUDIENCE_KINDS),
  topicId: z.uuid().nullable(),
  status: z.enum(NOTIFICATION_STATUSES),
  createdAt: z.iso.datetime(),
  expandedAt: z.iso.datetime().nullable(),
  rollUp: rollUpSchema,
});
export type NotificationSummary = z.infer<typeof notificationSummarySchema>;

export const notificationPageSchema = z.object({
  items: z.array(notificationSummarySchema),
  nextCursor: z.uuid().nullable(),
});
export type NotificationPage = z.infer<typeof notificationPageSchema>;

const renderedSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('email'), subject: z.string(), html: z.string(), text: z.string() }),
  z.object({ channel: z.literal('in-app'), title: z.string(), body: z.string(), actionUrl: z.string().nullable() }),
  z.object({ channel: z.literal('webhook'), payload: z.string() }),
]);

/** One attempt (R43, KTD9): the integration it used, the outcome, a short error and the content as rendered. */
export const attemptSchema = z.object({
  attempt: z.number().int(),
  integrationId: z.string().nullable(),
  integrationVersion: z.string().nullable(),
  status: z.enum(['accepted', 'failed']),
  error: z.string().nullable(),
  rendered: renderedSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type AttemptResponse = z.infer<typeof attemptSchema>;

/** One delivery (R43, R54), with its address shown in full, including a user's own (Key Decision on R43). */
export const deliverySchema = z.object({
  id: z.uuid(),
  recipientId: z.uuid(),
  channel: z.enum(POLICY_CHANNELS),
  step: z.number().int(),
  contactPointId: z.uuid().nullable(),
  address: z.string().nullable(),
  status: z.enum(DELIVERY_STATUSES),
  reason: z.string().nullable(),
  dueAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  attempts: z.array(attemptSchema),
});
export type DeliveryResponse = z.infer<typeof deliverySchema>;

/** The in-app item a recipient got, as rendered, with whether they read or acknowledged it. */
export const historyInboxItemSchema = z.object({
  id: z.uuid(),
  recipientId: z.uuid(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  actionUrl: z.string().nullable(),
  language: z.string().nullable(),
  readAt: z.iso.datetime().nullable(),
  acknowledgedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type HistoryInboxItem = z.infer<typeof historyInboxItemSchema>;

export const notificationDetailSchema = notificationSummarySchema.extend({
  deliveries: z.array(deliverySchema),
  inboxItems: z.array(historyInboxItemSchema),
});
export type NotificationDetail = z.infer<typeof notificationDetailSchema>;

/** A date as an ISO string, keeping null. */
export const iso = (date: Date | null): string | null => date?.toISOString() ?? null;
