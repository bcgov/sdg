import { jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import type {
  JsonbOf,
  NotificationTable,
  NotNull,
  TextColumn,
  TextPrimaryKey,
  TimestamptzDefaultNow,
} from './column-types.js';
import { notificationSchema } from './pg-schema.js';
import type { DataContract, DeliveryPolicy } from './value-types.js';

export type NotificationTypesTable = NotificationTable<
  'notification_types',
  {
    key: TextPrimaryKey;
    displayName: NotNull<TextColumn>;
    dataContract: JsonbOf<DataContract>;
    defaultLanguage: NotNull<TextColumn>;
    policy: JsonbOf<DeliveryPolicy>;
    createdAt: TimestamptzDefaultNow;
  }
>;

/**
 * A Notification type the admin curates (R13): its data contract, default language and delivery policy (R14).
 * Senders are granted types by key (R6).
 */
export const notificationTypes: NotificationTypesTable = notificationSchema.table('notification_types', {
  key: text().primaryKey(),
  displayName: text().notNull(),
  /** The JSON Schema subset in notification-api's `src/catalog/data-contract.ts`, validated when the type is defined. */
  dataContract: jsonb().$type<DataContract>().notNull(),
  /** A canonical BCP 47 tag, such as `en-CA`. */
  defaultLanguage: text().notNull(),
  /** notification-api's `src/catalog/policy.ts` policy, validated when the type is defined. */
  policy: jsonb().$type<DeliveryPolicy>().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
