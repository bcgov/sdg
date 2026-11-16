import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  readTableState,
  tableParamKeys,
  writeTableState,
  type TableChange,
  type TableConfig,
  type TableState,
} from './table-state';
import type { DataTablePaging, DataTableSearch, DataTableSearchChange, DataTableStatus } from './types';

/** The app's other params kept, this table's own replaced by the state's non-default values. */
function mergeTableParams(
  search: DataTableSearch,
  state: TableState,
  config: TableConfig,
  prefix: string | undefined,
): Record<string, unknown> {
  const owned = new Set(tableParamKeys(config, prefix));
  const others = Object.fromEntries(Object.entries(search).filter(([key]) => !owned.has(key)));
  return { ...others, ...writeTableState(state, config, prefix) };
}

/**
 * The state the URL should hold instead, if any (KTD8): a value the codec dropped, a page the server clamped (R14), or
 * a cursor whose page has no newer events. That is the newest page for an `after` cursor (KTD3), and for a `before`
 * cursor either the newest page too or an empty page past the oldest event (a link from another environment).
 */
function correction(
  state: TableState,
  corrected: boolean,
  status: DataTableStatus,
  paging: DataTablePaging,
): TableState | null {
  if (status === 'ready' && paging.mode === 'numbered' && paging.offset !== undefined) {
    const page = Math.floor(paging.offset / state.pageSize) + 1;
    if (page !== state.page) return { ...state, page };
  }
  if (status === 'ready' && paging.mode === 'cursor' && state.cursor && !paging.newer) {
    return { ...state, cursor: null };
  }
  return corrected ? state : null;
}

interface TableUrlOptions {
  search: DataTableSearch;
  config: TableConfig;
  prefix: string | undefined;
  onSearchChange: DataTableSearchChange;
  status: DataTableStatus;
  paging: DataTablePaging;
}

/** Reads the table's state from the URL, applies changes to it, and rewrites a corrected URL once with `replace`. */
export function useTableUrl({ search, config, prefix, onSearchChange, status, paging }: TableUrlOptions): {
  state: TableState;
  apply: (change: TableChange) => void;
} {
  const { state, corrected } = useMemo(() => readTableState(search, config, prefix), [search, config, prefix]);

  const apply = useCallback(
    (change: TableChange) =>
      onSearchChange(mergeTableParams(search, change.state, config, prefix), { replace: change.replace }),
    [search, config, prefix, onSearchChange],
  );

  const next = useMemo(() => {
    const target = correction(state, corrected, status, paging);
    return target ? mergeTableParams(search, target, config, prefix) : null;
  }, [state, corrected, status, paging, search, config, prefix]);
  const key = next ? JSON.stringify(next) : null;
  const sent = useRef<string | null>(null);
  useEffect(() => {
    // Once per distinct correction, even if the app re-renders before its URL catches up.
    if (key === sent.current) return;
    sent.current = key;
    if (next) onSearchChange(next, { replace: true });
  }, [key, next, onSearchChange]);

  return { state, apply };
}
