import { boolean, text, timestamp } from 'drizzle-orm/pg-core';

import type {
  BooleanColumn,
  HasDefault,
  IsPrimaryKey,
  NotNull,
  PgTableOf,
  TextColumn,
  TimestamptzDefaultNow,
} from './column-types.js';
import { coreSchema } from './core-schema.js';

export type ServiceClientsTable = PgTableOf<
  'service_clients',
  {
    clientId: IsPrimaryKey<NotNull<TextColumn>>;
    displayName: NotNull<TextColumn>;
    enabled: HasDefault<NotNull<BooleanColumn>>;
    createdAt: TimestamptzDefaultNow;
    updatedAt: TimestamptzDefaultNow;
  }
>;

/**
 * The service-account registry: the Keycloak clients whose client-credentials tokens may call gateway routes, while
 * enabled. Changes are recorded in `service_client_events`, which has no foreign key to this table.
 */
export const serviceClients: ServiceClientsTable = coreSchema.table('service_clients', {
  clientId: text().primaryKey(),
  displayName: text().notNull(),
  enabled: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ServiceClient = typeof serviceClients.$inferSelect;
export type NewServiceClient = typeof serviceClients.$inferInsert;
