import { sql } from 'drizzle-orm';
import { check, index, jsonb, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { notificationTypes } from './catalog.js';
import type {
  HasDefault,
  JsonbOf,
  NotificationTable,
  NotNull,
  TextColumn,
  TextOf,
  TimestamptzColumn,
  TimestamptzDefaultNow,
  UuidArrayColumn,
  UuidColumn,
  UuidPrimaryKey,
  UuidReference,
} from './column-types.js';
import { credentials } from './credentials.js';
import { notificationSchema } from './pg-schema.js';
import { senders } from './senders.js';
import { topics } from './topics.js';
import type { DeliveryPolicy, PinnedTemplates } from './value-types.js';

/**
 * A notification's lifecycle. `accepted`: stored by the send, waiting for a worker to expand it (R29). `expanded`: its
 * audience is fixed as notification recipients (R31), whose deliveries carry the rest of its progress (R55).
 */
export const NOTIFICATION_STATUSES = ['accepted', 'expanded'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Who a send named (R26): an explicit recipient list, a topic's subscribers, or the sender's whole audience (R30). */
export const AUDIENCE_KINDS = ['recipients', 'topic', 'everyone'] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];

export type NotificationsTable = NotificationTable<
  'notifications',
  {
    id: UuidPrimaryKey;
    senderId: UuidReference;
    credentialId: UuidColumn;
    typeKey: NotNull<TextColumn>;
    data: JsonbOf<Record<string, unknown>>;
    audienceKind: TextOf<AudienceKind>;
    recipientIds: UuidArrayColumn;
    topicId: UuidColumn;
    pinned: JsonbOf<PinnedTemplates>;
    policy: JsonbOf<DeliveryPolicy>;
    status: HasDefault<TextOf<NotificationStatus>>;
    expandedAt: TimestamptzColumn;
    createdAt: TimestamptzDefaultNow;
  }
>;

/**
 * An accepted send (R29). It records what the workers need without reading the catalog again (KTD7): the validated
 * data, the audience spec, the pinned template versions (which carry the type's default language) and the delivery
 * policy. A topic or "everyone" audience is fixed only when a worker expands it (R31), so the row names the topic,
 * not its subscribers.
 */
export const notifications: NotificationsTable = notificationSchema.table(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    senderId: uuid()
      .notNull()
      .references(() => senders.id, { onDelete: 'cascade' }),
    /** The credential that sent it; null once that credential is unlinked, so history outlives it. */
    credentialId: uuid().references(() => credentials.id, { onDelete: 'set null' }),
    typeKey: text()
      .notNull()
      .references(() => notificationTypes.key),
    /** The send's data after the type's contract dropped undeclared keys (R28). */
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    audienceKind: text().$type<AudienceKind>().notNull(),
    /** `recipients`: the resolved recipient ids, deduplicated, in the order the send named them. */
    recipientIds: uuid().array(),
    /** `topic`: the topic; null if the topic is later deleted. */
    topicId: uuid().references(() => topics.id, { onDelete: 'set null' }),
    /** Template, layout and partial versions and the type's default language at accept (KTD7). */
    pinned: jsonb().$type<PinnedTemplates>().notNull(),
    /** The type's delivery policy at accept (KTD7). */
    policy: jsonb().$type<DeliveryPolicy>().notNull(),
    status: text().$type<NotificationStatus>().notNull().default('accepted'),
    /** When a worker fixed the audience (R31, KTD14); null while it waits to be expanded. */
    expandedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_sender_id_created_at_idx').on(table.senderId, table.createdAt),
    index('notifications_unexpanded_idx')
      .on(table.createdAt)
      .where(sql`expanded_at IS NULL`),
    check(
      'notifications_audience_check',
      sql`(audience_kind = 'recipients' AND recipient_ids IS NOT NULL AND topic_id IS NULL)
        OR (audience_kind = 'topic' AND recipient_ids IS NULL)
        OR (audience_kind = 'everyone' AND recipient_ids IS NULL AND topic_id IS NULL)`,
    ),
  ],
);

/** How long a sender's idempotency key holds (KTD13). */
export const IDEMPOTENCY_WINDOW_HOURS = 24;

export type IdempotencyKeysTable = NotificationTable<
  'idempotency_keys',
  {
    senderId: UuidReference;
    key: NotNull<TextColumn>;
    requestHash: NotNull<TextColumn>;
    notificationId: UuidReference;
    createdAt: TimestamptzDefaultNow;
  }
>;

/**
 * A sender's idempotency key (KTD13) with the SHA-256 of its canonicalized request body. A key older than the window
 * counts as unused, and the next send with it replaces the row.
 */
export const idempotencyKeys: IdempotencyKeysTable = notificationSchema.table(
  'idempotency_keys',
  {
    senderId: uuid()
      .notNull()
      .references(() => senders.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    /** Hex SHA-256 of the canonical JSON of the validated request body. */
    requestHash: text().notNull(),
    notificationId: uuid()
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.senderId, table.key] })],
);
