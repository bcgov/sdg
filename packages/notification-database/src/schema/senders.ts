import { primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { notificationTypes } from './catalog.js';
import type {
  NotificationTable,
  NotNull,
  TextColumn,
  TimestamptzDefaultNow,
  UuidPrimaryKey,
  UuidReference,
} from './column-types.js';
import { notificationSchema } from './pg-schema.js';

export type SendersTable = NotificationTable<
  'senders',
  {
    id: UuidPrimaryKey;
    name: NotNull<TextColumn>;
    callbackUrl: TextColumn;
    callbackSecret: TextColumn;
    createdAt: TimestamptzDefaultNow;
    updatedAt: TimestamptzDefaultNow;
  }
>;

/** A system that sends notifications, created by the admin (R6). */
export const senders: SendersTable = notificationSchema.table('senders', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  /** Where failed deliveries are reported (R7, R42). https only. */
  callbackUrl: text(),
  /** The callback's Standard Webhooks signing secret (KTD10), sealed by SecretCipher at (id, `callbackSecret`). */
  callbackSecret: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SenderOwnersTable = NotificationTable<
  'sender_owners',
  {
    senderId: UuidReference;
    issuer: NotNull<TextColumn>;
    subject: NotNull<TextColumn>;
    createdAt: TimestamptzDefaultNow;
  }
>;

/** A person who manages a sender, named by the admin as the IdP identifies them (R6). */
export const senderOwners: SenderOwnersTable = notificationSchema.table(
  'sender_owners',
  {
    senderId: uuid()
      .notNull()
      .references(() => senders.id, { onDelete: 'cascade' }),
    issuer: text().notNull(),
    subject: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.senderId, table.issuer, table.subject] })],
);

export type SenderTypeGrantsTable = NotificationTable<
  'sender_type_grants',
  {
    senderId: UuidReference;
    typeKey: NotNull<TextColumn>;
    createdAt: TimestamptzDefaultNow;
  }
>;

/** A Notification type the admin granted a sender, by type key (R6). The type must exist. */
export const senderTypeGrants: SenderTypeGrantsTable = notificationSchema.table(
  'sender_type_grants',
  {
    senderId: uuid()
      .notNull()
      .references(() => senders.id, { onDelete: 'cascade' }),
    typeKey: text()
      .notNull()
      .references(() => notificationTypes.key),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.senderId, table.typeKey] })],
);
