import { featureFlagEvents, principals, type FeatureFlagEvent } from '@repo/database';
import { and, asc, desc, eq, gt, lt, type SQL } from 'drizzle-orm';

import type { Database } from '../database/database.module.js';
import {
  flagChangesSchema,
  type FlagEventView,
  type FlagHistoryPage,
  type FlagHistoryQuery,
} from './feature-flags.schemas.js';

const { id } = featureFlagEvents;

function toView({ event, subjectName }: { event: FeatureFlagEvent; subjectName: string | null }): FlagEventView {
  return {
    id: event.id,
    flagKey: event.flagKey,
    action: event.action,
    actor: { principalId: event.actorPrincipalId, name: event.actorName },
    subject: event.subjectPrincipalId === null ? null : { principalId: event.subjectPrincipalId, name: subjectName },
    changes: flagChangesSchema.parse(event.changes),
    createdAt: event.createdAt.toISOString(),
  };
}

/** Up to `limit + 1` events, so the caller can tell whether more exist on the side being read. */
async function readEvents(db: Database, where: SQL | undefined, order: 'asc' | 'desc', limit: number) {
  const rows = await db
    .select({ event: featureFlagEvents, subjectName: principals.displayName })
    .from(featureFlagEvents)
    .leftJoin(principals, eq(principals.id, featureFlagEvents.subjectPrincipalId))
    .where(where)
    .orderBy(order === 'asc' ? asc(id) : desc(id))
    .limit(limit + 1);
  return { items: rows.slice(0, limit).map(toView), more: rows.length > limit };
}

async function exists(db: Database, where: SQL | undefined): Promise<boolean> {
  return (await db.select({ id }).from(featureFlagEvents).where(where).limit(1)).length > 0;
}

/**
 * The log newest first, optionally for one key (KTD3). `before` reads older than that id, `after` reads newer
 * (ascending, then reversed), neither the newest. A side's cursor is its boundary event's id when that side has more
 * events, else null. An `after` read that reaches the newest events answers the newest page, as with no cursor.
 */
export async function readHistory(
  db: Database,
  { key, limit, before, after }: FlagHistoryQuery,
): Promise<FlagHistoryPage> {
  const ofKey = key === undefined ? undefined : eq(featureFlagEvents.flagKey, key);
  if (after !== undefined) {
    const newer = await readEvents(db, and(ofKey, gt(id, after)), 'asc', limit);
    const oldest = newer.items[0]?.id;
    if (newer.more && oldest !== undefined) {
      const items = newer.items.toReversed();
      const older = (await exists(db, and(ofKey, lt(id, oldest)))) ? oldest : null;
      return { items, older, newer: items[0]?.id ?? null };
    }
  }
  const page = await readEvents(db, and(ofKey, before === undefined ? undefined : lt(id, before)), 'desc', limit);
  const newest = page.items[0]?.id;
  if (newest === undefined) return { items: [], older: null, newer: null };
  const newer = before !== undefined && (await exists(db, and(ofKey, gt(id, newest)))) ? newest : null;
  return { items: page.items, older: page.more ? (page.items.at(-1)?.id ?? null) : null, newer };
}
