import { ConflictException, Injectable } from '@nestjs/common';
import { featureFlagEvents, featureFlagOverrides, featureFlags, principals, type FeatureFlag } from '@repo/database';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';

import { InjectDatabase, type Database } from '../database/database.module.js';
import {
  kindOf,
  lockFlag,
  missingFlag,
  overrideTargets,
  recordEvent,
  type Actor,
  type Transaction,
} from './feature-flag-records.js';
import {
  flagChangesSchema,
  type CreateFlag,
  type FlagDetail,
  type FlagHistoryPage,
  type FlagHistoryQuery,
  type FlagSummary,
  type OverrideView,
  type UpdateFlag,
} from './feature-flags.schemas.js';

type Counts = FlagSummary['overrideCounts'];

/** The editable fields, and the column name each is recorded under in an event's `changes` (KTD7). */
const FIELDS = {
  description: 'description',
  enabled: 'enabled',
  rolloutPct: 'rollout_pct',
  audience: 'audience',
} as const;
type Field = keyof typeof FIELDS;
const FIELD_NAMES: readonly Field[] = ['description', 'enabled', 'rolloutPct', 'audience'];
type FieldValues = Partial<Pick<FeatureFlag, Field>>;

const NO_OVERRIDES: Counts = { on: 0, off: 0 };

function toSummary(flag: FeatureFlag, overrideCounts: Counts): FlagSummary {
  const { key, description, enabled, rolloutPct, audience } = flag;
  return { key, description, enabled, rolloutPct, audience, overrideCounts };
}

/** KTD13: an empty description (already trimmed by the schema) is stored as null. */
const description = (value: string | null | undefined) => (value === '' ? null : value);

/** The fields of `next` that differ from `current`, as an update and as `{ column: { from, to } }`. */
function diff(
  current: Partial<FeatureFlag>,
  next: FieldValues,
): { set: FieldValues; changes: Record<string, unknown> } {
  const set: FieldValues = {};
  const changes: Record<string, unknown> = {};
  for (const field of FIELD_NAMES) {
    const to = next[field];
    if (to === undefined || to === current[field]) continue;
    Object.assign(set, { [field]: to });
    changes[FIELDS[field]] = { from: current[field] ?? null, to };
  }
  return { set, changes };
}

/**
 * The console's flag management (R15–R17, R19, R21). Every change commits together with its history event; a change
 * that changes nothing records nothing (KTD8). Keys never change (R2).
 */
@Injectable()
export class FeatureFlagsService {
  private readonly db: Database;

  constructor(@InjectDatabase() db: Database) {
    this.db = db;
  }

  /** Every flag by key, with its "on" and "off" override counts. */
  async list(): Promise<FlagSummary[]> {
    const [flags, counts] = await Promise.all([
      this.db.select().from(featureFlags).orderBy(asc(featureFlags.key)),
      countOverrides(this.db),
    ]);
    return flags.map((flag) => toSummary(flag, counts.get(flag.key) ?? NO_OVERRIDES));
  }

  /** The flag with every override, each with its target's current name, email and kind; 404 when it doesn't exist. */
  async detail(key: string): Promise<FlagDetail> {
    const [[flag], rows] = await Promise.all([
      this.db.select().from(featureFlags).where(eq(featureFlags.key, key)),
      this.db.select().from(featureFlagOverrides).where(eq(featureFlagOverrides.flagKey, key)),
    ]);
    if (flag === undefined) throw missingFlag(key);
    const targets = new Map(
      (
        await overrideTargets(
          this.db,
          rows.map((row) => row.userId),
        )
      ).map((t) => [t.principalId, t]),
    );
    const overrides = rows.flatMap((row): OverrideView[] => {
      const target = targets.get(row.userId);
      if (target === undefined) return [];
      const { principalId, name, email } = target;
      return [{ principalId, name, email, kind: kindOf(target, flag.audience), enabled: row.enabled }];
    });
    overrides.sort((a, b) => a.name.localeCompare(b.name));
    const on = rows.filter((row) => row.enabled).length;
    return { ...toSummary(flag, { on, off: rows.length - on }), overrides };
  }

  /** 409 when the key exists. Records `created` with every field's initial value. */
  create(input: CreateFlag, actor: Actor): Promise<FlagSummary> {
    const { key, enabled, rolloutPct, audience } = input;
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(featureFlags)
        .values({ key, description: description(input.description), enabled, rolloutPct, audience })
        .onConflictDoNothing()
        .returning();
      if (created === undefined) throw new ConflictException(`Feature flag ${key} already exists`);
      const { changes } = diff({}, created);
      await recordEvent(tx, { flagKey: key, action: 'created', changes }, actor);
      return toSummary(created, NO_OVERRIDES);
    });
  }

  /** Changes only the given fields and records `updated` with those that changed; 404 when the flag doesn't exist. */
  update(key: string, input: UpdateFlag, actor: Actor): Promise<FlagSummary> {
    return this.db.transaction(async (tx) => {
      const current = await lockFlag(tx, key);
      const { set, changes } = diff(current, { ...input, description: description(input.description) });
      let flag = current;
      if (Object.keys(set).length > 0) {
        const [updated] = await tx.update(featureFlags).set(set).where(eq(featureFlags.key, key)).returning();
        flag = updated ?? current;
        await recordEvent(tx, { flagKey: key, action: 'updated', changes }, actor);
      }
      // The R21 notice needs the "on" count of a flag just turned off.
      return toSummary(flag, (await countOverrides(tx, key)).get(key) ?? NO_OVERRIDES);
    });
  }

  /** Deletes the flag and its overrides and records one `deleted` event; 404 when it doesn't exist. History stays. */
  remove(key: string, actor: Actor): Promise<void> {
    return this.db.transaction(async (tx) => {
      await lockFlag(tx, key);
      const overridesRemoved = await tx.$count(featureFlagOverrides, eq(featureFlagOverrides.flagKey, key));
      await tx.delete(featureFlags).where(eq(featureFlags.key, key));
      await recordEvent(tx, { flagKey: key, action: 'deleted', changes: { overridesRemoved } }, actor);
    });
  }

  /** The log newest first, optionally for one key, `limit` events before the event id `before`. */
  async history({ key, limit, before }: FlagHistoryQuery): Promise<FlagHistoryPage> {
    const rows = await this.db
      .select({ event: featureFlagEvents, subjectName: principals.displayName })
      .from(featureFlagEvents)
      .leftJoin(principals, eq(principals.id, featureFlagEvents.subjectPrincipalId))
      .where(
        and(
          key === undefined ? undefined : eq(featureFlagEvents.flagKey, key),
          before === undefined ? undefined : lt(featureFlagEvents.id, before),
        ),
      )
      .orderBy(desc(featureFlagEvents.id))
      .limit(limit + 1);
    const events = rows.slice(0, limit).map(({ event, subjectName }) => ({
      id: event.id,
      flagKey: event.flagKey,
      action: event.action,
      actor: { principalId: event.actorPrincipalId, name: event.actorName },
      subject: event.subjectPrincipalId === null ? null : { principalId: event.subjectPrincipalId, name: subjectName },
      changes: flagChangesSchema.parse(event.changes),
      createdAt: event.createdAt.toISOString(),
    }));
    return { events, nextBefore: rows.length > limit ? (events.at(-1)?.id ?? null) : null };
  }
}

/** Each flag's (or one flag's) "on" and "off" override counts. */
async function countOverrides(db: Database | Transaction, key?: string): Promise<Map<string, Counts>> {
  const rows = await db
    .select({
      flagKey: featureFlagOverrides.flagKey,
      on: sql<number>`(count(*) filter (where ${featureFlagOverrides.enabled}))::int`,
      off: sql<number>`(count(*) filter (where not ${featureFlagOverrides.enabled}))::int`,
    })
    .from(featureFlagOverrides)
    .where(key === undefined ? undefined : eq(featureFlagOverrides.flagKey, key))
    .groupBy(featureFlagOverrides.flagKey);
  return new Map(rows.map(({ flagKey, on, off }) => [flagKey, { on, off }]));
}
