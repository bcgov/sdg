import { sql, type $Type } from 'drizzle-orm';
import { bigint, check, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type {
  BigIntColumn,
  IsIdentity,
  IsPrimaryKey,
  NotNull,
  PgTableOf,
  TextColumn,
  TimestamptzDefaultNow,
  UuidColumn,
} from './column-types.js';
import { coreSchema } from './core-schema.js';

/** What happened to a registry entry. */
export const SERVICE_CLIENT_ACTIONS: readonly ['added', 'disabled', 'enabled', 'removed'] = [
  'added',
  'disabled',
  'enabled',
  'removed',
];
export type ServiceClientAction = (typeof SERVICE_CLIENT_ACTIONS)[number];

export type ServiceClientEventsTable = PgTableOf<
  'service_client_events',
  {
    id: IsIdentity<IsPrimaryKey<NotNull<BigIntColumn>>, 'always'>;
    clientId: NotNull<TextColumn>;
    action: NotNull<$Type<TextColumn, ServiceClientAction>>;
    actorPrincipalId: NotNull<UuidColumn>;
    actorName: NotNull<TextColumn>;
    createdAt: TimestamptzDefaultNow;
  }
>;

const actionList = SERVICE_CLIENT_ACTIONS.map((action) => `'${action}'`).join(', ');

/**
 * The registry's history: one row per change, with the administrator who made it (principal id and a snapshot of
 * their display name). No foreign keys, so the log outlives removed clients and principals, and a re-added client id
 * continues its history. `id` orders the log.
 */
export const serviceClientEvents: ServiceClientEventsTable = coreSchema.table(
  'service_client_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    clientId: text().notNull(),
    action: text().$type<ServiceClientAction>().notNull(),
    actorPrincipalId: uuid().notNull(),
    actorName: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('service_client_events_action_check', sql`${table.action} in (${sql.raw(actionList)})`)],
);

export type ServiceClientEvent = typeof serviceClientEvents.$inferSelect;
export type NewServiceClientEvent = typeof serviceClientEvents.$inferInsert;
