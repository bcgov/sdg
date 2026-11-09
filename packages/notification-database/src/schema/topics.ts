import { boolean, index, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import type {
  BooleanColumn,
  HasDefault,
  NotificationTable,
  NotNull,
  TextColumn,
  TimestamptzDefaultNow,
  UuidColumn,
  UuidPrimaryKey,
  UuidReference,
} from './column-types.js';
import { notificationSchema } from './pg-schema.js';
import { senders } from './senders.js';

export type TopicsTable = NotificationTable<
  'topics',
  {
    id: UuidPrimaryKey;
    senderId: UuidColumn;
    key: NotNull<TextColumn>;
    name: NotNull<TextColumn>;
    selfSubscribe: HasDefault<NotNull<BooleanColumn>>;
    createdAt: TimestamptzDefaultNow;
  }
>;

/**
 * A topic recipients subscribe to and senders broadcast to. A platform topic (no sender) is created by the admin
 * (R15); a sender topic belongs to the sender whose credential created it, and only that sender broadcasts to it
 * (R16). Keys are unique among platform topics and within each sender.
 */
export const topics: TopicsTable = notificationSchema.table(
  'topics',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Null for a platform topic. */
    senderId: uuid().references(() => senders.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    name: text().notNull(),
    /** Whether recipients may subscribe and unsubscribe themselves (R17). Closed by default. */
    selfSubscribe: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('topics_sender_id_key_key').on(table.senderId, table.key).nullsNotDistinct()],
);

export type TopicBroadcastGrantsTable = NotificationTable<
  'topic_broadcast_grants',
  {
    topicId: UuidReference;
    senderId: UuidReference;
    createdAt: TimestamptzDefaultNow;
  }
>;

/** A sender the admin granted permission to broadcast to a platform topic (R15). */
export const topicBroadcastGrants: TopicBroadcastGrantsTable = notificationSchema.table(
  'topic_broadcast_grants',
  {
    topicId: uuid()
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    senderId: uuid()
      .notNull()
      .references(() => senders.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.topicId, table.senderId] }),
    index('topic_broadcast_grants_sender_id_idx').on(table.senderId),
  ],
);
