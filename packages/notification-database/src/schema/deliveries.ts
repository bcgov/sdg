import { sql } from 'drizzle-orm';
import { index, integer, jsonb, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import type {
  $Type,
  HasDefault,
  IntegerColumn,
  IntegerDefault,
  JsonbColumn,
  NotificationTable,
  NotNull,
  TextColumn,
  TextOf,
  TimestamptzColumn,
  TimestamptzDefaultNow,
  UuidColumn,
  UuidPrimaryKey,
  UuidReference,
} from './column-types.js';
import { notifications } from './notifications.js';
import { notificationSchema } from './pg-schema.js';
import { contactPoints, recipients } from './recipients.js';
import type { PolicyChannel, RenderedParts } from './value-types.js';

/**
 * A delivery's lifecycle (R54): `scheduled` until a worker claims it (`sending`), then `delivered`, or it ends
 * `failed`, `cancelled` or `skipped` with a recorded reason. For email, `delivered` means the integration accepted it.
 */
export const DELIVERY_STATUSES = ['scheduled', 'sending', 'delivered', 'failed', 'cancelled', 'skipped'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export type NotificationRecipientsTable = NotificationTable<
  'notification_recipients',
  {
    id: UuidPrimaryKey;
    notificationId: UuidReference;
    recipientId: UuidReference;
    plannedAt: TimestamptzColumn;
    escalationStoppedAt: TimestamptzColumn;
    createdAt: TimestamptzDefaultNow;
  }
>;

/**
 * One recipient of a notification, fixed when a worker expands its audience (R31). The unique pair makes a repeated
 * expansion a no-op, so a crash and retry neither duplicates recipients nor adds late subscribers (KTD14).
 */
export const notificationRecipients: NotificationRecipientsTable = notificationSchema.table(
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
    index('notification_recipients_unplanned_idx')
      .on(table.createdAt)
      .where(sql`planned_at IS NULL`),
  ],
);

export type InboxItemsTable = NotificationTable<
  'inbox_items',
  {
    id: UuidPrimaryKey;
    notificationRecipientId: UuidReference;
    notificationId: UuidReference;
    recipientId: UuidReference;
    title: TextColumn;
    body: TextColumn;
    actionUrl: TextColumn;
    language: TextColumn;
    templateVersionId: UuidColumn;
    readAt: TimestamptzColumn;
    acknowledgedAt: TimestamptzColumn;
    createdAt: TimestamptzDefaultNow;
  }
>;

/**
 * The in-app item every notification to a recipient with an inbox creates (R38), rendered when it is planned. One
 * per notification recipient, so it is never duplicated (R53). Content is null when the type has no in-app template
 * in the recipient's or the default language, or it failed to render.
 */
export const inboxItems: InboxItemsTable = notificationSchema.table(
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

export type DeliveriesTable = NotificationTable<
  'deliveries',
  {
    id: UuidPrimaryKey;
    notificationId: UuidReference;
    notificationRecipientId: UuidReference;
    recipientId: UuidReference;
    channel: TextOf<PolicyChannel>;
    step: IntegerDefault;
    delayMinutes: IntegerDefault;
    contactPointId: UuidColumn;
    address: TextColumn;
    dedupeKey: TextColumn;
    status: HasDefault<TextOf<DeliveryStatus>>;
    reason: TextColumn;
    dueAt: TimestamptzColumn;
    leaseUntil: TimestamptzColumn;
    attempts: IntegerDefault;
    finishedAt: TimestamptzColumn;
    createdAt: TimestamptzDefaultNow;
    updatedAt: TimestamptzDefaultNow;
  }
>;

/**
 * One delivery on a policy channel to one contact point (KTD7): the queue rows workers claim (KTD1). The row id is
 * the stable delivery ID, sent as `webhook-id` and in the email Message-ID (R53). `step` 0 is an all-at-once
 * delivery; steps 1… are escalation steps, whose `due_at` stays null until the previous step reaches a final status
 * (KTD8).
 */
export const deliveries: DeliveriesTable = notificationSchema.table(
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
    /** The point's normalized address at planning, for history (R43). */
    address: text(),
    /**
     * The address again for an all-at-once email to a point usable at planning, so a mailbox shared by recipients
     * gets one email (KTD14); null otherwise. A point still pending verification, and an escalation step, keep their
     * own row: they depend on that one recipient's state, which mustn't decide another recipient's email.
     */
    dedupeKey: text(),
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
    // One mailbox gets one all-at-once email per notification, whichever recipients it belongs to (KTD14).
    uniqueIndex('deliveries_dedupe_key')
      .on(table.notificationId, table.step, table.dedupeKey)
      .where(sql`dedupe_key IS NOT NULL`),
  ],
);

export type DeliveryAttemptsTable = NotificationTable<
  'delivery_attempts',
  {
    id: UuidPrimaryKey;
    deliveryId: UuidReference;
    attempt: NotNull<IntegerColumn>;
    integrationId: TextColumn;
    integrationVersion: TextColumn;
    status: TextOf<'accepted' | 'failed'>;
    error: TextColumn;
    rendered: $Type<JsonbColumn, RenderedParts>;
    createdAt: TimestamptzDefaultNow;
  }
>;

/**
 * One attempt to send a delivery (R43): the integration id and config version it used (KTD9), the outcome, a short
 * error (never a response body, R51) and the content exactly as rendered.
 */
export const deliveryAttempts: DeliveryAttemptsTable = notificationSchema.table(
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
