import type { FlagEvent, MockFlag } from './mock-console-api';

// core-api's list conventions, answered in the browser: the flag list's numbered pages and a flag history's cursor
// pages (KTD2, KTD3).

type Summary = Omit<MockFlag, 'overrides'>;

const FIRST_ORDER: Readonly<Record<string, 'asc' | 'desc'>> = {
  key: 'asc',
  audience: 'asc',
  enabled: 'desc',
  rolloutPct: 'desc',
  overridesOn: 'desc',
};

function sortValue(flag: Summary, column: string): string | number {
  if (column === 'overridesOn') return flag.overrideCounts.on;
  if (column === 'enabled') return flag.enabled ? 1 : 0;
  if (column === 'audience') return flag.audience;
  if (column === 'rolloutPct') return flag.rolloutPct;
  return flag.key;
}

function matches(flag: Summary, query: URLSearchParams): boolean {
  const q = query.get('q')?.toLowerCase();
  const audience = query.get('audience');
  const enabled = query.get('enabled');
  return (
    (!q || `${flag.key}\n${flag.description ?? ''}`.toLowerCase().includes(q)) &&
    (audience === null || flag.audience === audience || flag.audience === 'both') &&
    (enabled === null || String(flag.enabled) === enabled)
  );
}

/** `GET /api/v1/console/feature-flags`: search, filters, one sort with key as tiebreak, the last page past the end. */
export function flagListPage(flags: readonly Summary[], query: URLSearchParams) {
  const limit = Number(query.get('limit') ?? 20);
  const column = Object.hasOwn(FIRST_ORDER, query.get('sort') ?? '') ? query.get('sort')! : 'key';
  const sign = (query.get('order') ?? FIRST_ORDER[column]) === 'desc' ? -1 : 1;
  const matching = flags
    .filter((flag) => matches(flag, query))
    .toSorted((a, b) => {
      const [x, y] = [sortValue(a, column), sortValue(b, column)];
      if (x !== y) return x < y ? -sign : sign;
      return a.key < b.key ? -1 : 1;
    });
  const asked = Number(query.get('offset') ?? 0);
  const offset = asked < matching.length ? asked : Math.max(0, Math.ceil(matching.length / limit) - 1) * limit;
  return { items: matching.slice(offset, offset + limit), total: matching.length, limit, offset };
}

/** `GET /api/v1/console/feature-flag-history`: newest first; an `after` reaching the newest answers the newest page. */
export function flagHistoryPage(events: readonly FlagEvent[], query: URLSearchParams) {
  const limit = Number(query.get('limit') ?? 20);
  const all = events.filter((event) => event.flagKey === query.get('key')).toSorted((a, b) => b.id - a.id);
  const after = query.get('after');
  const newer = after === null ? [] : all.filter((event) => event.id > Number(after));
  if (newer.length > limit) {
    const items = newer.slice(-limit);
    const oldest = items.at(-1)!.id;
    return { items, older: all.some((event) => event.id < oldest) ? oldest : null, newer: items[0]!.id };
  }
  const before = query.get('before');
  const candidates = before === null ? all : all.filter((event) => event.id < Number(before));
  const items = candidates.slice(0, limit);
  const newest = items[0]?.id;
  if (newest === undefined) return { items: [], older: null, newer: null };
  const hasNewer = before !== null && all.some((event) => event.id > newest);
  return { items, older: candidates.length > limit ? items.at(-1)!.id : null, newer: hasNewer ? newest : null };
}
