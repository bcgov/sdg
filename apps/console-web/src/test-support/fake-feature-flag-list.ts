import type { FlagEvent, FlagSummary } from '../api/feature-flags';

// core-api's list conventions for the flag list (numbered) and the flag history (cursor), in memory.

type SortColumn = 'key' | 'audience' | 'enabled' | 'rolloutPct' | 'overridesOn';

/** Each sortable column with its first direction, as core-api's flag list query declares them. */
const FIRST_ORDER: Readonly<Record<SortColumn, 'asc' | 'desc'>> = {
  key: 'asc',
  audience: 'asc',
  enabled: 'desc',
  rolloutPct: 'desc',
  overridesOn: 'desc',
};

const isSortColumn = (value: string | null): value is SortColumn => value !== null && Object.hasOwn(FIRST_ORDER, value);

const sortValue = (flag: FlagSummary, column: SortColumn): string | number => {
  if (column === 'overridesOn') return flag.overrideCounts.on;
  if (column === 'enabled') return flag.enabled ? 1 : 0;
  return flag[column];
};

function matches(flag: FlagSummary, query: URLSearchParams): boolean {
  const q = query.get('q')?.trim().toLowerCase();
  const audience = query.get('audience');
  const enabled = query.get('enabled');
  return (
    (!q || `${flag.key}\n${flag.description ?? ''}`.toLowerCase().includes(q)) &&
    (audience === null || flag.audience === audience || flag.audience === 'both') &&
    (enabled === null || String(flag.enabled) === enabled)
  );
}

/** The last page's offset when `offset` is past the end, 0 when nothing matches (R14). */
const clampOffset = (offset: number, limit: number, total: number) =>
  offset < total ? offset : Math.max(0, Math.ceil(total / limit) - 1) * limit;

/** `GET /api/v1/console/feature-flags`: search, filters, one sort with the key as tiebreak, and a clamped page. */
export function flagListPage(flags: readonly FlagSummary[], query: URLSearchParams) {
  const limit = Number(query.get('limit') ?? 20);
  const sortParam = query.get('sort');
  const column: SortColumn = isSortColumn(sortParam) ? sortParam : 'key';
  const order = query.get('order') ?? FIRST_ORDER[column];
  const sign = order === 'desc' ? -1 : 1;
  const matching = flags
    .filter((flag) => matches(flag, query))
    .toSorted((a, b) => {
      const [x, y] = [sortValue(a, column), sortValue(b, column)];
      if (x !== y) return x < y ? -sign : sign;
      return a.key < b.key ? -1 : 1;
    });
  const offset = clampOffset(Number(query.get('offset') ?? 0), limit, matching.length);
  return { items: matching.slice(offset, offset + limit), total: matching.length, limit, offset };
}

/**
 * `GET /api/v1/console/feature-flag-history`, newest first (KTD3): `before` reads older than an id, `after` newer;
 * an `after` read that reaches the newest events answers the newest page, as with no cursor.
 */
export function flagHistoryPage(events: readonly FlagEvent[], query: URLSearchParams) {
  const limit = Number(query.get('limit') ?? 20);
  const key = query.get('key');
  const newestFirst = events.filter((event) => key === null || event.flagKey === key).toSorted((a, b) => b.id - a.id);
  const after = query.get('after');
  if (after !== null) {
    const newer = newestFirst.filter((event) => event.id > Number(after));
    if (newer.length > limit) {
      const items = newer.slice(-limit);
      const oldest = items.at(-1)!.id;
      const older = newestFirst.some((event) => event.id < oldest) ? oldest : null;
      return { items, older, newer: items[0]!.id };
    }
  }
  const before = query.get('before');
  const candidates = before === null ? newestFirst : newestFirst.filter((event) => event.id < Number(before));
  const items = candidates.slice(0, limit);
  const newest = items[0]?.id;
  if (newest === undefined) return { items: [], older: null, newer: null };
  const newer = before !== null && newestFirst.some((event) => event.id > newest) ? newest : null;
  return { items, older: candidates.length > limit ? items.at(-1)!.id : null, newer };
}
