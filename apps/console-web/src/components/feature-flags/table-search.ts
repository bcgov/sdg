import { tableParamKeys, type TableConfig, type TableState } from '@repo/design-system/components/data-table';

import type { FlagHistoryQuery, FlagListQuery } from '../../api/feature-flags';

/** A route's search params: every value a plain string (KTD8). */
export type StringSearch = Readonly<Record<string, string | undefined>>;

/** The flag list: search, the audience and switch filters, every column sortable, key ascending first (R15, R16). */
export const FLAG_LIST_CONFIG: TableConfig = {
  mode: 'numbered',
  search: true,
  filters: [
    {
      key: 'audience',
      label: 'Audience',
      options: [
        { value: 'portal', label: 'Portal' },
        { value: 'console', label: 'Console' },
      ],
    },
    {
      key: 'enabled',
      label: 'Switch',
      options: [
        { value: 'true', label: 'On' },
        { value: 'false', label: 'Off' },
      ],
    },
  ],
  sortable: { key: 'asc', audience: 'asc', enabled: 'desc', rolloutPct: 'desc', overridesOn: 'desc' },
  defaultSort: { column: 'key', direction: 'asc' },
};

/** A flag's history pages through cursors (event ids); its params carry the `h.` prefix beside the list's (KTD10). */
export const HISTORY_CONFIG: TableConfig = { mode: 'cursor', isCursor: (raw) => /^[1-9]\d{0,15}$/.test(raw) };
export const HISTORY_PREFIX = 'h';

const LIST_KEYS = tableParamKeys(FLAG_LIST_CONFIG);
const HISTORY_KEYS = tableParamKeys(HISTORY_CONFIG, HISTORY_PREFIX);

/** The plain-string values in `search`, only under `keys` when given. */
export function stringParams(search: Readonly<Record<string, unknown>>, keys?: readonly string[]) {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === 'string' && (!keys || keys.includes(key))) params[key] = value;
  }
  return params;
}

/** The flag list's own params, which a flag's page carries so deleting returns to the same view (R18). */
export const listParams = (search: Readonly<Record<string, unknown>>) => stringParams(search, LIST_KEYS);

export const historyParams = (search: Readonly<Record<string, unknown>>) => stringParams(search, HISTORY_KEYS);

export function flagListQuery(state: TableState): FlagListQuery {
  return {
    limit: state.pageSize,
    offset: (state.page - 1) * state.pageSize,
    q: state.search || undefined,
    audience: state.filters['audience'],
    enabled: state.filters['enabled'],
    sort: state.sort?.column,
    order: state.sort?.direction,
  };
}

export function historyQuery(key: string, state: TableState): FlagHistoryQuery {
  const { cursor } = state;
  return {
    key,
    limit: state.pageSize,
    before: cursor && 'before' in cursor ? cursor.before : undefined,
    after: cursor && 'after' in cursor ? cursor.after : undefined,
  };
}
