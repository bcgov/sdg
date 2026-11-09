import { sql } from 'drizzle-orm';
import { index, integer, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import type {
  HasDefault,
  IntegerDefault,
  NotificationTable,
  NotNull,
  TextColumn,
  TextOf,
  TimestamptzColumn,
  TimestamptzDefaultNow,
  UuidPrimaryKey,
  UuidReference,
} from './column-types.js';
import { deliveries } from './deliveries.js';
import { notificationSchema } from './pg-schema.js';
import { senders } from './senders.js';

/** A failure callback's lifecycle: queued like a delivery and retried with the same bounds (KTD10). */
export type CallbackStatus = 'scheduled' | 'sending' | 'delivered' | 'failed' | 'skipped';

export type FailureCallbacksTable = NotificationTable<
  'failure_callbacks',
  {
    id: UuidPrimaryKey;
    deliveryId: UuidReference;
    senderId: UuidReference;
    status: HasDefault<TextOf<CallbackStatus>>;
    reason: TextColumn;
    dueAt: NotNull<TimestamptzColumn>;
    leaseUntil: TimestamptzColumn;
    attempts: IntegerDefault;
    lastError: TextColumn;
    createdAt: TimestamptzDefaultNow;
    updatedAt: TimestamptzDefaultNow;
  }
>;

/**
 * A failed delivery's call to its sender's failure callback URL (R42), queued as its own row and retried with the
 * same bounds as deliveries (KTD10). One per delivery: it carries the delivery's stable ID.
 */
export const failureCallbacks: FailureCallbacksTable = notificationSchema.table(
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
