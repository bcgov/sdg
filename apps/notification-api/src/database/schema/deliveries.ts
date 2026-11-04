import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import type { PolicyChannel } from '../../catalog/policy.js';
import type { RenderedParts } from '../../templates/renderer.js';
import { notifications } from './notifications.js';
import { contactPoints, recipients } from './recipients.js';
import { senders } from './senders.js';

/**
 * A delivery's lifecycle (R54): `scheduled` until a worker claims it (`sending`), then `delivered`, or it ends
 * `failed`, `cancelled` or `skipped` with a recorded reason. For email, `delivered` means the integration accepted it.
 */
export const DELIVERY_STATUSES = ['scheduled', 'sending', 'delivered', 'failed', 'cancelled', 'skipped'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** The statuses a delivery ends in. */
export const FINAL_DELIVERY_STATUSES = ['delivered', 'failed', 'cancelled', 'skipped'] as const;

/** A failure callback's lifecycle: queued like a delivery and retried with the same bounds (KTD10). */
export type CallbackStatus = 'scheduled' | 'sending' | 'delivered' | 'failed' | 'skipped';

/**
 * One recipient of a notification, fixed when a worker expands its audience (R31). The unique pair makes a repeated
 * expansion a no-op, so a crash and retry neither duplicates recipients nor adds late subscribers (KTD14).
 */
export const notificationRecipients = pgTable(
  'notification_recipients',
  {
    id: uuid().primaryKey().defaultRandom(),
    notificationId: uuid()
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    recipientId: uuid()
      .notNull()
      .references(() => recipients.id, { onDelete: 'cascade' }),
    /** When the planner wrote the in-app item and deliveries; null while it waits to be planned. */
    plannedAt: timestamp({ withTimezone: true }),
    /** When an in-app read or acknowledgement stopped the escalation (R18). */
    escalationStoppedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('notification_recipients_notification_id_recipient_id_key').on(table.notificationId, table.recipientId),
    index('notification_recipients_recipient_id_idx').on(table.recipientId),
    // The planner's queue.
    index('notification_recipients_unplanned_idx')
      .on(table.createdAt)
      .where(sql`planned_at IS NULL`),
  ],
);

/**
 * The in-app item every notification to a recipient with an inbox creates (R38), rendered when it is planned. One
 * per notification recipient, so it is never duplicated (R53). Content is null when the type has no in-app template
 * in the recipient's or the default language, or it failed to render.
 */
export const inboxItems = pgTable(
  'inbox_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    notificationRecipientId: uuid()
      .notNull()
      .references(() => notificationRecipients.id, { onDelete: 'cascade' }),
    notificationId: uuid()
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    recipientId: uuid()
      .notNull()
      .references(() => recipients.id, { onDelete: 'cascade' }),
    title: text(),
    /** Sanitized HTML. */
    body: text(),
    actionUrl: text(),
    language: text(),
    templateVersionId: uuid(),
    readAt: timestamp({ withTimezone: true }),
    acknowledgedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('inbox_items_notification_recipient_id_key').on(table.notificationRecipientId),
    index('inbox_items_recipient_id_created_at_idx').on(table.recipientId, table.createdAt),
  ],
);

/**
 * One delivery on a policy channel to one contact point (KTD7): the queue rows workers claim (KTD1). The row id is
 * the stable delivery ID, sent as `webhook-id` and in the email Message-ID (R53). `step` 0 is an all-at-once
 * delivery; steps 1… are escalation steps, whose `due_at` stays null until the previous step reaches a final status
 * (KTD8).
 */
export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid().primaryKey().defaultRandom(),
    notificationId: uuid()
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    notificationRecipientId: uuid()
      .notNull()
      .references(() => notificationRecipients.id, { onDelete: 'cascade' }),
    recipientId: uuid()
      .notNull()
      .references(() => recipients.id, { onDelete: 'cascade' }),
    channel: text().$type<PolicyChannel>().notNull(),
    step: integer().notNull().default(0),
    /** Escalation: minutes after the previous step's final status (KTD8). */
    delayMinutes: integer().notNull().default(0),
    /** The contact point fixed at planning; null for a "no contact point" row, or once the point is removed. */
    contactPointId: uuid().references(() => contactPoints.id, { onDelete: 'set null' }),
    /** The point's normalized address at planning, for deduplication (KTD14) and history (R43). */
    address: text(),
    status: text().$type<DeliveryStatus>().notNull().default('scheduled'),
    /** Why it ended `failed`, `cancelled` or `skipped` (R54). */
    reason: text(),
    /** When it may be claimed; null while an escalation step waits for the previous one. */
    dueAt: timestamp({ withTimezone: true }),
    leaseUntil: timestamp({ withTimezone: true }),
    /** Claims so far, counting one a crashed worker never recorded. Holds and skips don't count. */
    attempts: integer().notNull().default(0),
    finishedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('deliveries_due_idx')
      .on(table.dueAt)
      .where(sql`status = 'scheduled' AND due_at IS NOT NULL`),
    index('deliveries_lease_idx')
      .on(table.leaseUntil)
      .where(sql`status = 'sending'`),
    index('deliveries_notification_recipient_id_step_idx').on(table.notificationRecipientId, table.step),
    index('deliveries_notification_id_idx').on(table.notificationId),
    index('deliveries_recipient_id_idx').on(table.recipientId),
    // One mailbox gets one email per notification and step, whichever recipients it belongs to (KTD14).
    uniqueIndex('deliveries_email_address_key')
      .on(table.notificationId, table.step, table.address)
      .where(sql`channel = 'email' AND address IS NOT NULL`),
  ],
);

/**
 * One attempt to send a delivery (R43): the integration id and config version it used (KTD9), the outcome, a short
 * error (never a response body, R51) and the content exactly as rendered.
 */
export const deliveryAttempts = pgTable(
  'delivery_attempts',
  {
    id: uuid().primaryKey().defaultRandom(),
    deliveryId: uuid()
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    attempt: integer().notNull(),
    integrationId: text(),
    integrationVersion: text(),
    status: text().$type<'accepted' | 'failed'>().notNull(),
    error: text(),
    rendered: jsonb().$type<RenderedParts>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('delivery_attempts_delivery_id_idx').on(table.deliveryId)],
);

/**
 * A failed delivery's call to its sender's failure callback URL (R42), queued as its own row and retried with the
 * same bounds as deliveries (KTD10). One per delivery: it carries the delivery's stable ID.
 */
export const failureCallbacks = pgTable(
  'failure_callbacks',
  {
    id: uuid().primaryKey().defaultRandom(),
    deliveryId: uuid()
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    senderId: uuid()
      .notNull()
      .references(() => senders.id, { onDelete: 'cascade' }),
    status: text().$type<CallbackStatus>().notNull().default('scheduled'),
    reason: text(),
    dueAt: timestamp({ withTimezone: true }).notNull(),
    leaseUntil: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('failure_callbacks_delivery_id_key').on(table.deliveryId),
    index('failure_callbacks_due_idx')
      .on(table.dueAt)
      .where(sql`status = 'scheduled'`),
    index('failure_callbacks_lease_idx')
      .on(table.leaseUntil)
      .where(sql`status = 'sending'`),
  ],
);
