import { sql, type $Type } from 'drizzle-orm';
import { boolean, check, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';

import type {
  BooleanColumn,
  HasDefault,
  IsPrimaryKey,
  NotNull,
  PgTableOf,
  SmallIntColumn,
  TextColumn,
  UuidColumn,
} from './column-types.js';
import { coreSchema } from './core-schema.js';
import { principals } from './principals.js';

/** The apps a flag applies to. */
export const FEATURE_FLAG_AUDIENCES: readonly ['portal', 'console', 'both'] = ['portal', 'console', 'both'];
export type FeatureFlagAudience = (typeof FEATURE_FLAG_AUDIENCES)[number];

export type FeatureFlagsTable = PgTableOf<
  'feature_flags',
  {
    key: IsPrimaryKey<NotNull<TextColumn>>;
    description: TextColumn;
    enabled: HasDefault<NotNull<BooleanColumn>>;
    rolloutPct: HasDefault<NotNull<SmallIntColumn>>;
    audience: HasDefault<NotNull<$Type<TextColumn, FeatureFlagAudience>>>;
  }
>;

const audienceList = FEATURE_FLAG_AUDIENCES.map((audience) => `'${audience}'`).join(', ');

/**
 * A feature flag: off by default, rolled out to `rollout_pct` percent of people when on, and listed only to the apps
 * in its audience. Code refers to a flag by its key, which never changes.
 */
export const featureFlags: FeatureFlagsTable = coreSchema.table(
  'feature_flags',
  {
    key: text().primaryKey(),
    description: text(),
    enabled: boolean().notNull().default(false),
    rolloutPct: smallint().notNull().default(100),
    audience: text().$type<FeatureFlagAudience>().notNull().default('portal'),
  },
  (table) => [
    check('feature_flags_rollout_pct_check', sql`${table.rolloutPct} between 0 and 100`),
    check('feature_flags_audience_check', sql`${table.audience} in (${sql.raw(audienceList)})`),
  ],
);

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;

export type FeatureFlagOverridesTable = PgTableOf<
  'feature_flag_overrides',
  {
    flagKey: NotNull<TextColumn>;
    userId: NotNull<UuidColumn>;
    enabled: NotNull<BooleanColumn>;
  }
>;

/**
 * Forces a flag on or off for one person, whatever the flag's switch and rollout say. Goes when its flag or its
 * principal is deleted.
 */
export const featureFlagOverrides: FeatureFlagOverridesTable = coreSchema.table(
  'feature_flag_overrides',
  {
    flagKey: text()
      .notNull()
      .references(() => featureFlags.key, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    enabled: boolean().notNull(),
  },
  (table) => [primaryKey({ name: 'feature_flag_overrides_pkey', columns: [table.flagKey, table.userId] })],
);

export type FeatureFlagOverride = typeof featureFlagOverrides.$inferSelect;
export type NewFeatureFlagOverride = typeof featureFlagOverrides.$inferInsert;
