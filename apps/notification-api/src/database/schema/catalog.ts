import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import type { DataContract } from '../../catalog/data-contract.js';
import type { DeliveryPolicy } from '../../catalog/policy.js';

/**
 * A Notification type the admin curates (R13): its data contract, default language and delivery policy (R14).
 * Senders are granted types by key (R6).
 */
export const notificationTypes = pgTable('notification_types', {
  key: text().primaryKey(),
  displayName: text().notNull(),
  /** The JSON Schema subset in `src/catalog/data-contract.ts`, validated when the type is defined. */
  dataContract: jsonb().$type<DataContract>().notNull(),
  /** A canonical BCP 47 tag, such as `en-CA`. */
  defaultLanguage: text().notNull(),
  /** `src/catalog/policy.ts`'s policy, validated when the type is defined. */
  policy: jsonb().$type<DeliveryPolicy>().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
