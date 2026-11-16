// URL codec and pure state transitions for the DataTable (KTD8).
// The app passes its URL search params as plain strings; these helpers read them into a
// table's state with defaults and write back only the values that differ from the defaults.

export type SortDirection = 'asc' | 'desc';

export interface TableSort {
  column: string;
  direction: SortDirection;
}

/** A cursor-mode position: older than, or newer than, an opaque id. */
export type TableCursor = { before: string } | { after: string };

export const PAGE_SIZES = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 20;

export interface TableFilterOption {
  value: string;
  label: string;
}

export interface TableFilter {
  /** The URL param (before the prefix) and the key in `TableState.filters`. */
  key: string;
  label: string;
  options: readonly TableFilterOption[];
}

export interface TableConfig {
  /** `numbered` pages with a known total; `cursor` pages through older and newer events. */
  mode: 'numbered' | 'cursor';
  search?: boolean;
  filters?: readonly TableFilter[];
  /** Sortable column ids, each with the direction its first activation sorts in (R4). */
  sortable?: Readonly<Record<string, SortDirection>>;
  defaultSort?: TableSort;
}

export interface TableState {
  search: string;
  /** Only the filters that are set; a missing key means Any. */
  filters: Readonly<Record<string, string>>;
  sort: TableSort | undefined;
  pageSize: PageSize;
  /** 1-based page, numbered mode only. */
  page: number;
  /** Cursor mode only; null is the newest page. */
  cursor: TableCursor | null;
}

/** A transition's result: the next state, and whether to replace the history entry instead of pushing. */
export interface TableChange {
  state: TableState;
  replace: boolean;
}

export interface ReadResult {
  state: TableState;
  /** True when the URL held a value this table dropped, so the caller should rewrite it with `replace`. */
  corrected: boolean;
}

type Params = Readonly<Record<string, unknown>>;

const keyFor = (prefix: string | undefined) => (name: string) => (prefix ? `${prefix}.${name}` : name);

const POSITIVE_INTEGER = /^[1-9]\d*$/;

/** Every URL key this table owns, so a caller can remove stale ones before merging `writeTableState`. */
export function tableParamKeys(config: TableConfig, prefix?: string): string[] {
  const names = [
    ...(config.search ? ['q'] : []),
    ...(config.filters ?? []).map((filter) => filter.key),
    ...(config.sortable ? ['sort', 'order'] : []),
    'pageSize',
    ...(config.mode === 'numbered' ? ['page'] : ['before', 'after']),
  ];
  return names.map(keyFor(prefix));
}

function defaultTableState(config: TableConfig): TableState {
  return { search: '', filters: {}, sort: config.defaultSort, pageSize: DEFAULT_PAGE_SIZE, page: 1, cursor: null };
}

export function readTableState(params: Params, config: TableConfig, prefix?: string): ReadResult {
  const key = keyFor(prefix);
  let corrected = false;
  // A present but unusable value (wrong type, unknown or malformed) is dropped and noted.
  const read = <T>(name: string, parse: (value: string) => T | undefined): T | undefined => {
    if (!(key(name) in params)) return undefined;
    const raw = params[key(name)];
    const parsed = typeof raw === 'string' ? parse(raw) : undefined;
    if (parsed === undefined) corrected = true;
    return parsed;
  };

  const state = defaultTableState(config);
  if (config.search) state.search = read('q', (value) => value) ?? '';
  state.filters = readFilters(config, read);
  state.sort = readSort(config, read);
  state.pageSize = read('pageSize', parsePageSize) ?? DEFAULT_PAGE_SIZE;
  if (config.mode === 'numbered') {
    state.page = read('page', parsePage) ?? 1;
  } else {
    state.cursor = readCursor(read, () => {
      corrected = true;
    });
  }
  return { state, corrected };
}

type Reader = <T>(name: string, parse: (value: string) => T | undefined) => T | undefined;

function readFilters(config: TableConfig, read: Reader): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const filter of config.filters ?? []) {
    const value = read(filter.key, (raw) => (filter.options.some((option) => option.value === raw) ? raw : undefined));
    if (value !== undefined) filters[filter.key] = value;
  }
  return filters;
}

function readSort(config: TableConfig, read: Reader): TableSort | undefined {
  const sortable = config.sortable;
  if (!sortable) return config.defaultSort;
  const column = read('sort', (raw) => (Object.hasOwn(sortable, raw) ? raw : undefined));
  const order = read('order', (raw) => (raw === 'asc' || raw === 'desc' ? raw : undefined));
  if (column !== undefined) return { column, direction: order ?? firstDirection(config, column) };
  if (config.defaultSort && order !== undefined) return { ...config.defaultSort, direction: order };
  return config.defaultSort;
}

const nonEmpty = (raw: string) => (raw === '' ? undefined : raw);

function readCursor(read: Reader, drop: () => void): TableCursor | null {
  const before = read('before', nonEmpty);
  const after = read('after', nonEmpty);
  if (before !== undefined && after !== undefined) {
    // Older and newer at once is malformed: start from the newest.
    drop();
    return null;
  }
  if (before !== undefined) return { before };
  if (after !== undefined) return { after };
  return null;
}

function parsePageSize(raw: string): PageSize | undefined {
  return PAGE_SIZES.find((size) => String(size) === raw);
}

function parsePage(raw: string): number | undefined {
  if (!POSITIVE_INTEGER.test(raw)) return undefined;
  const page = Number(raw);
  return Number.isSafeInteger(page) ? page : undefined;
}

function firstDirection(config: TableConfig, column: string): SortDirection {
  return config.sortable?.[column] ?? 'asc';
}

const sameSort = (a: TableSort | undefined, b: TableSort | undefined) =>
  a?.column === b?.column && a?.direction === b?.direction;

export function writeTableState(state: TableState, config: TableConfig, prefix?: string): Record<string, string> {
  const key = keyFor(prefix);
  const params: Record<string, string> = {};
  if (config.search && state.search !== '') params[key('q')] = state.search;
  for (const filter of config.filters ?? []) {
    const value = state.filters[filter.key];
    if (value !== undefined) params[key(filter.key)] = value;
  }
  if (config.sortable && state.sort && !sameSort(state.sort, config.defaultSort)) {
    params[key('sort')] = state.sort.column;
    params[key('order')] = state.sort.direction;
  }
  if (state.pageSize !== DEFAULT_PAGE_SIZE) params[key('pageSize')] = String(state.pageSize);
  if (config.mode === 'numbered' && state.page > 1) params[key('page')] = String(state.page);
  if (config.mode === 'cursor' && state.cursor) {
    if ('before' in state.cursor) params[key('before')] = state.cursor.before;
    else params[key('after')] = state.cursor.after;
  }
  return params;
}

// Transitions. Each pushes a history entry; the DataTable replaces instead for a search edit that
// follows another while the field keeps focus (KTD8). Every change but a page or cursor move
// returns to the first page, or the newest in cursor mode (R8).

const firstPage = (state: TableState): TableState => ({ ...state, page: 1, cursor: null });
const push = (state: TableState): TableChange => ({ state, replace: false });

export function setSearch(state: TableState, search: string): TableChange {
  return push(firstPage({ ...state, search }));
}

export function setFilter(state: TableState, key: string, value: string | undefined): TableChange {
  const { [key]: _previous, ...rest } = state.filters;
  return push(firstPage({ ...state, filters: value === undefined ? rest : { ...rest, [key]: value } }));
}

const opposite = (direction: SortDirection): SortDirection => (direction === 'asc' ? 'desc' : 'asc');

/** R4: first direction, then the opposite, then the default sort; the default column only toggles. */
export function setSort(state: TableState, config: TableConfig, column: string): TableChange {
  const current = state.sort;
  const first = firstDirection(config, column);
  let sort: TableSort | undefined;
  if (current?.column !== column) sort = { column, direction: first };
  else if (column === config.defaultSort?.column || current.direction === first) {
    sort = { column, direction: opposite(current.direction) };
  } else sort = config.defaultSort;
  return push(firstPage({ ...state, sort }));
}

export function setPageSize(state: TableState, pageSize: PageSize): TableChange {
  return push(firstPage({ ...state, pageSize }));
}

export function goToPage(state: TableState, page: number): TableChange {
  return push({ ...state, page });
}

export function goToCursor(state: TableState, cursor: TableCursor | null): TableChange {
  return push({ ...state, cursor });
}

/** Whether a search or any filter is set. */
export function hasQuery({ search, filters }: Pick<TableState, 'search' | 'filters'>): boolean {
  return search !== '' || Object.keys(filters).length > 0;
}
