import { featureFlagOverrides, featureFlags } from '@repo/database';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

import { clampOffset, containsPattern } from '../common/list-query.js';
import type { Database } from '../database/database.module.js';
import type { FlagListQuery, FlagPage, FlagSortColumn } from './feature-flags.schemas.js';

/** Each flag's "on" and "off" override counts; flags without overrides have no row. */
const overrideCounts = (db: Database) =>
  db
    .select({
      flagKey: featureFlagOverrides.flagKey,
      on: sql<number>`count(*) filter (where ${featureFlagOverrides.enabled})`.as('on_count'),
      off: sql<number>`count(*) filter (where not ${featureFlagOverrides.enabled})`.as('off_count'),
    })
    .from(featureFlagOverrides)
    .groupBy(featureFlagOverrides.flagKey)
    .as('override_counts');

/** The search and filters (KTD5): `portal` and `console` each also match `both`. */
function matching({ q, audience, enabled }: FlagListQuery): SQL | undefined {
  const pattern = q === undefined ? undefined : containsPattern(q);
  return and(
    pattern === undefined ? undefined : or(ilike(featureFlags.key, pattern), ilike(featureFlags.description, pattern)),
    audience === undefined ? undefined : inArray(featureFlags.audience, [audience, 'both']),
    enabled === undefined ? undefined : eq(featureFlags.enabled, enabled),
  );
}

/** One page in the requested order, key breaking ties (R12), with the matching total from `count(*) over ()`. */
async function selectPage(db: Database, query: FlagListQuery, offset: number) {
  const counts = overrideCounts(db);
  const on = sql<number>`coalesce(${counts.on}, 0)::int`;
  const sortBy: Record<FlagSortColumn, SQLWrapper> = {
    key: featureFlags.key,
    audience: featureFlags.audience,
    enabled: featureFlags.enabled,
    rolloutPct: featureFlags.rolloutPct,
    overridesOn: on,
  };
  const direction = query.order === 'asc' ? asc : desc;
  const order =
    query.sort === 'key' ? [direction(featureFlags.key)] : [direction(sortBy[query.sort]), asc(featureFlags.key)];
  const rows = await db
    .select({
      key: featureFlags.key,
      description: featureFlags.description,
      enabled: featureFlags.enabled,
      rolloutPct: featureFlags.rolloutPct,
      audience: featureFlags.audience,
      on,
      off: sql<number>`coalesce(${counts.off}, 0)::int`,
      total: sql<number>`(count(*) over ())::int`,
    })
    .from(featureFlags)
    .leftJoin(counts, eq(counts.flagKey, featureFlags.key))
    .where(matching(query))
    .orderBy(...order)
    .limit(query.limit)
    .offset(offset);
  const items = rows.map(({ on: onCount, off, total: _total, ...flag }) => ({
    ...flag,
    overrideCounts: { on: onCount, off },
  }));
  return { items, total: rows[0]?.total ?? 0 };
}

/**
 * The flag list's numbered page (KTD5): one query for any in-range page. An empty page past the start carries no
 * window count, so a plain count supplies the total, and a page that shrank answers its last page instead (R14).
 */
export async function listFlags(db: Database, query: FlagListQuery): Promise<FlagPage> {
  const { limit } = query;
  const page = await selectPage(db, query, query.offset);
  if (page.items.length > 0 || query.offset === 0) return { ...page, limit, offset: query.offset };
  const total = await db.$count(featureFlags, matching(query));
  if (total === 0) return { items: [], total: 0, limit, offset: 0 };
  const offset = clampOffset(query.offset, limit, total);
  return { ...(await selectPage(db, query, offset)), limit, offset };
}
