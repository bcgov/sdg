import { sql, type $Type } from 'drizzle-orm';
import { bigint, check, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type {
  BigIntColumn,
  HasDefault,
  IsIdentity,
  IsPrimaryKey,
  JsonbColumn,
  NotNull,
  PgTableOf,
  TextColumn,
  TimestamptzDefaultNow,
  UuidColumn,
} from './column-types.js';
import { coreSchema } from './core-schema.js';

/** What happened to a flag or one of its overrides. */
export const FEATURE_FLAG_EVENT_ACTIONS: readonly [
  'created',
  'updated',
  'deleted',
  'override_set',
  'override_removed',
] = ['created', 'updated', 'deleted', 'override_set', 'override_removed'];
export type FeatureFlagEventAction = (typeof FEATURE_FLAG_EVENT_ACTIONS)[number];

/** What changed: `{ field: { from, to } }`, or a delete's `overridesRemoved` count. */
export type FeatureFlagEventChanges = Record<string, unknown>;

export type FeatureFlagEventsTable = PgTableOf<
  'feature_flag_events',
  {
    id: IsIdentity<IsPrimaryKey<NotNull<BigIntColumn>>, 'always'>;
    flagKey: NotNull<TextColumn>;
    action: NotNull<$Type<TextColumn, FeatureFlagEventAction>>;
    actorPrincipalId: NotNull<UuidColumn>;
    actorName: NotNull<TextColumn>;
    subjectPrincipalId: UuidColumn;
    changes: HasDefault<NotNull<$Type<JsonbColumn, FeatureFlagEventChanges>>>;
    createdAt: TimestamptzDefaultNow;
  }
>;

const actionList = FEATURE_FLAG_EVENT_ACTIONS.map((action) => `'${action}'`).join(', ');

/**
 * The flags' history: one row per change, with the administrator who made it (principal id and a snapshot of their
 * display name) and, for an override, the principal it targets. No foreign keys, so the log outlives deleted flags,
 * overrides and principals. `id` orders the log.
 */
export const featureFlagEvents: FeatureFlagEventsTable = coreSchema.table(
  'feature_flag_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    flagKey: text().notNull(),
    action: text().$type<FeatureFlagEventAction>().notNull(),
    actorPrincipalId: uuid().notNull(),
    actorName: text().notNull(),
    subjectPrincipalId: uuid(),
    changes: jsonb().$type<FeatureFlagEventChanges>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('feature_flag_events_action_check', sql`${table.action} in (${sql.raw(actionList)})`)],
);

export type FeatureFlagEvent = typeof featureFlagEvents.$inferSelect;
export type NewFeatureFlagEvent = typeof featureFlagEvents.$inferInsert;
