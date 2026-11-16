/**
 * Where the rows stand: `loading` is a first load with nothing to show, `refreshing` keeps the previous rows while the
 * next page, sort or search loads (KTD11), `error` is a failed load (a failed refresh included), and `blocked` is a
 * search the edge firewall refused, which the same text can never pass (KTD12).
 */
export type DataTableStatus = 'loading' | 'refreshing' | 'ready' | 'error' | 'blocked';

/**
 * The server's answer about paging. Numbered mode: the total matching count and the offset the server used, which
 * differs from the URL's page when the server clamped a page past the end (R14). Cursor mode: the cursors for the next
 * older and next newer pages, or null when there are none (KTD3). Must match the config's `mode`.
 */
export type DataTablePaging =
  | { mode: 'numbered'; total: number; offset?: number }
  | { mode: 'cursor'; older: string | null; newer: string | null };

/** The app's URL search params, as plain strings (KTD8). */
export type DataTableSearch = Readonly<Record<string, unknown>>;

/** Writes the next search params to the URL: push a history entry, or replace the current one. */
export type DataTableSearchChange = (next: Record<string, unknown>, options: { replace: boolean }) => void;

/** The text the table shows when it has no rows to show. */
export interface DataTableMessages {
  /** Nothing to list, with no search or filter set. */
  empty: string;
  /** Nothing matches the search or filters. */
  noMatches: string;
  /** The load failed. */
  error: string;
  /** The edge refused the search text. */
  blocked: string;
}
