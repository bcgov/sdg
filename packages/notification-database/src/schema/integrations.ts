import { integer, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import type {
  IntegerDefault,
  JsonbOf,
  NotificationTable,
  NotNull,
  TextColumn,
  TextOf,
  TimestamptzDefaultNow,
  UuidPrimaryKey,
  UuidReference,
} from './column-types.js';
import { notificationSchema } from './pg-schema.js';
import { senders } from './senders.js';
import type { Channel } from './value-types.js';

export type SenderIntegrationsTable = NotificationTable<
  'sender_integrations',
  {
    id: UuidPrimaryKey;
    senderId: UuidReference;
    channel: TextOf<Channel>;
    type: NotNull<TextColumn>;
    config: JsonbOf<Record<string, unknown>>;
    version: IntegerDefault;
    createdAt: TimestamptzDefaultNow;
    updatedAt: TimestamptzDefaultNow;
  }
>;

/**
 * A sender's own integration for one channel, overriding the platform default (R47). `config` is the type's
 * configuration with each secret field sealed by SecretCipher at (id, `config.<field>`) (R48, KTD11). `version`
 * goes up on every change; a delivery attempt records the id and version it used (KTD9).
 */
export const senderIntegrations: SenderIntegrationsTable = notificationSchema.table(
  'sender_integrations',
  {
    id: uuid().primaryKey().defaultRandom(),
    senderId: uuid()
      .notNull()
      .references(() => senders.id, { onDelete: 'cascade' }),
    channel: text().$type<Channel>().notNull(),
    type: text().notNull(),
    config: jsonb().$type<Record<string, unknown>>().notNull(),
    version: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique('sender_integrations_sender_id_channel_key').on(table.senderId, table.channel)],
);
