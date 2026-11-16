import {
  createColumnHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnHelper,
  type RowData,
} from '@tanstack/react-table';
import { type JSX, useCallback, useMemo, useRef } from 'react';
import { Button, type SortDescriptor } from 'react-aria-components';

import { DataTableGrid } from './data-table-grid';
import { cursorControls, DataTablePager, numberedControls } from './data-table-pager';
import { DataTableToolbar } from './data-table-toolbar';
import {
  goToCursor,
  goToPage,
  setFilter,
  setPageSize,
  setSearch,
  setSort,
  type PageSize,
  type TableChange,
  type TableConfig,
  type TableState,
  hasQuery,
} from './table-state';
import type {
  DataTableMessages,
  DataTablePaging,
  DataTableSearch,
  DataTableSearchChange,
  DataTableStatus,
} from './types';
import { useTableUrl } from './use-table-url';

import styles from './data-table.module.css';

// Manual mode (KTD6): the server sorts and pages, TanStack holds the columns, the sort and the page count.
type DataTableFeatures = {
  rowSortingFeature: typeof rowSortingFeature;
  rowPaginationFeature: typeof rowPaginationFeature;
};
const features: DataTableFeatures = tableFeatures({ rowSortingFeature, rowPaginationFeature });

/** A column: TanStack's column def, with `header` and `cell`. Its id is a sort column when the config lists it. */
// oxlint-disable-next-line typescript/no-explicit-any -- each column has its own value type, as TanStack's own column arrays do
export type DataTableColumn<TData extends RowData> = ColumnDef<DataTableFeatures, TData, any>;

/** TanStack's column helper for a DataTable's rows, so `accessor` infers each cell's value type. */
export function dataTableColumnHelper<TData extends RowData>(): ColumnHelper<DataTableFeatures, TData> {
  return createColumnHelper<DataTableFeatures, TData>();
}

export interface DataTableProps<TData extends RowData> {
  /** Names the table, shown above it. */
  caption: string;
  /** The first column is the row header. */
  columns: readonly DataTableColumn<TData>[];
  /** The current page's rows; keep the previous page's while refreshing (KTD11). */
  rows: readonly TData[];
  getRowId: (row: TData) => string;
  /** Makes each row a link, followed through the app's react-aria RouterProvider (KTD9). */
  getRowHref?: (row: TData) => string;
  /** Search, filters, sortable columns and mode (R2). Keep it stable, e.g. at module scope. */
  config: TableConfig;
  paging: DataTablePaging;
  /** The page URL's search params as plain strings, and the way to write them (KTD8). */
  search: DataTableSearch;
  onSearchChange: DataTableSearchChange;
  /** Prefixes this table's URL params, for a page with more than one table (R7). */
  prefix?: string;
  status: DataTableStatus;
  /** Offered after a failed load. */
  onRetry?: () => void;
  messages?: Partial<DataTableMessages>;
}

const DEFAULT_MESSAGES: DataTableMessages = {
  empty: 'There is nothing here yet.',
  noMatches: 'Nothing matches the search or filters.',
  error: "This list couldn't be loaded. Try again in a moment.",
  // console-web's people search wording (KTD12).
  blocked:
    'The search was blocked. Some punctuation, such as an apostrophe, can be refused. Search for part of the text instead.',
};

type View = 'loading' | 'rows' | 'empty' | 'noMatches' | 'error' | 'blocked';

function viewOf(status: DataTableStatus, rowCount: number, hasQuery: boolean): View {
  if (status === 'loading' || status === 'error' || status === 'blocked') return status;
  if (rowCount > 0) return 'rows';
  return hasQuery ? 'noMatches' : 'empty';
}

const NO_ROWS: readonly never[] = [];

/** The TanStack table in manual mode, holding the URL's sort and page (KTD6), and react-aria's matching sort. */
function useManualTable<TData extends RowData>(
  columns: readonly DataTableColumn<TData>[],
  data: readonly TData[],
  getRowId: (row: TData) => string,
  state: TableState,
  paging: DataTablePaging,
) {
  const sorting = useMemo(
    () => (state.sort ? [{ id: state.sort.column, desc: state.sort.direction === 'desc' }] : []),
    [state.sort],
  );
  const table = useTable({
    features,
    columns,
    data,
    getRowId,
    manualSorting: true,
    manualPagination: true,
    rowCount: paging.mode === 'numbered' ? paging.total : undefined,
    state: { sorting, pagination: { pageIndex: state.page - 1, pageSize: state.pageSize } },
  });
  const [sort] = sorting;
  const sortDescriptor: SortDescriptor | undefined = sort
    ? { column: sort.id, direction: sort.desc ? 'descending' : 'ascending' }
    : undefined;
  return { table, sortDescriptor };
}

function useFocusFirstRow() {
  const gridRef = useRef<HTMLTableElement>(null);
  const focusFirstRow = useCallback(() => {
    const row = gridRef.current?.querySelector<HTMLElement>('tbody [role="row"]');
    row?.focus();
    return Boolean(row);
  }, []);
  return { gridRef, focusFirstRow };
}

type Apply = (change: TableChange) => void;

/** Every change the controls make, each a pure transition applied to the URL (R8). */
function useTableActions(state: TableState, config: TableConfig, apply: Apply) {
  const onSearch = useCallback(
    (text: string, replace: boolean) => apply({ ...setSearch(state, text), replace }),
    [state, apply],
  );
  const onFilter = useCallback(
    (key: string, value: string | undefined) => apply(setFilter(state, key, value)),
    [state, apply],
  );
  const onClear = useCallback(() => apply(setSearch({ ...state, filters: {} }, '')), [state, apply]);
  const onSort = useCallback((column: string) => apply(setSort(state, config, column)), [state, config, apply]);
  const onPageSize = useCallback((size: PageSize) => apply(setPageSize(state, size)), [state, apply]);
  return { onSearch, onFilter, onClear, onSort, onPageSize };
}

const NO_HEADERS: readonly never[] = [];

/**
 * A server-paged table (R1): search and filters above, the count, rows per page and pager below (R3), every setting in
 * the page URL (R7), in numbered (R5) or cursor (R6) mode.
 */
export function DataTable<TData extends RowData>(props: Readonly<DataTableProps<TData>>): JSX.Element {
  const { caption, columns, rows, getRowId, config, paging, search, onSearchChange, prefix, status } = props;
  const { state, apply } = useTableUrl({ search, config, prefix, onSearchChange, status, paging });
  const actions = useTableActions(state, config, apply);
  const messages = { ...DEFAULT_MESSAGES, ...props.messages };
  const view = viewOf(status, rows.length, hasQuery(state));
  const isBusy = status === 'loading' || status === 'refreshing';
  const { gridRef, focusFirstRow } = useFocusFirstRow();
  const shown = view === 'loading' || view === 'error' || view === 'blocked' ? NO_ROWS : rows;
  const { table, sortDescriptor } = useManualTable(columns, shown, getRowId, state, paging);
  const pager = pagerProps(paging, state, rows.length, table.getPageCount(), apply);
  return (
    <div className={styles['root']}>
      {view !== 'empty' && (config.search || config.filters?.length) ? (
        <DataTableToolbar config={config} search={state.search} filters={state.filters} {...actions} />
      ) : null}
      <DataTableGrid
        caption={caption}
        isBusy={isBusy}
        headers={table.getHeaderGroups().at(-1)?.headers ?? NO_HEADERS}
        rows={view === 'loading' ? null : table.getRowModel().rows}
        sortable={config.sortable}
        sortDescriptor={sortDescriptor}
        onSort={actions.onSort}
        getRowHref={props.getRowHref}
        emptyMessage={view === 'rows' || view === 'loading' ? null : messages[view]}
        gridRef={gridRef}
      />
      {view === 'error' && props.onRetry && (
        <Button className={styles['button']} onPress={props.onRetry}>
          Try again
        </Button>
      )}
      {view === 'rows' && (
        <DataTablePager
          {...pager}
          isBusy={isBusy}
          pageSize={state.pageSize}
          onPageSize={actions.onPageSize}
          focusFirstRow={focusFirstRow}
        />
      )}
      <output className={styles['visuallyHidden']}>
        {isBusy ? '' : announcement(view, pager.range, rows.length, messages)}
      </output>
    </div>
  );
}

function pagerProps(paging: DataTablePaging, state: TableState, rowCount: number, pageCount: number, apply: Apply) {
  if (paging.mode === 'cursor') {
    return { controls: cursorControls(paging.older, paging.newer, (cursor) => apply(goToCursor(state, cursor))) };
  }
  // The offset the server used wins over the URL's page, which it may have clamped (R14).
  const start = paging.offset ?? (state.page - 1) * state.pageSize;
  const page = Math.floor(start / state.pageSize) + 1;
  const pages = Math.max(pageCount, 1);
  return {
    range: `Showing ${start + 1}–${start + rowCount} of ${paging.total}`,
    pageLabel: `Page ${page} of ${pages}`,
    controls: numberedControls(page, pages, (next) => apply(goToPage(state, next))),
  };
}

/** What the persistent status region says once a load settles (R10, KTD11). */
function announcement(view: View, range: string | undefined, rowCount: number, messages: DataTableMessages): string {
  if (view === 'rows') return range ?? `${rowCount} ${rowCount === 1 ? 'row' : 'rows'} shown`;
  if (view === 'loading') return '';
  return messages[view];
}
