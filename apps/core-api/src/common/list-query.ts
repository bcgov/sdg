import { z } from 'zod';

/**
 * core-api's list convention (KTD1–KTD3). Numbered lists, for data with a knowable total, take `limit`, `offset`,
 * `q`, per-endpoint filters and `sort` with `order`, and answer `{ items, total, limit, offset }`. Cursor lists, for
 * large or append-only data (the default for any history or log), take `limit` and at most one of `before` or `after`
 * (an id), and answer `{ items, older, newer }`, newest first.
 */

export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 100;

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

const limitSchema = z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).default(LIST_DEFAULT_LIMIT);
const cursorSchema = z.coerce.number().int().positive();

export interface NumberedQueryConfig<C extends string, F extends z.ZodRawShape> {
  /** Each sortable column with its first direction: text ascending, numbers descending (R4). */
  sort: Record<C, SortOrder>;
  defaultSort: NoInfer<C>;
  /** Per-endpoint filter params, each optional; `{}` for none. */
  filters: F;
}

function isSortOrder(value: unknown): value is SortOrder {
  return value === 'asc' || value === 'desc';
}

/** The order sent, or else the sort column's first direction. */
function orderFor(query: object, firstOrders: ReadonlyMap<string, SortOrder>): SortOrder {
  if ('order' in query && isSortOrder(query.order)) return query.order;
  const first = 'sort' in query && typeof query.sort === 'string' ? firstOrders.get(query.sort) : undefined;
  return first ?? 'asc';
}

/**
 * A numbered list's query (KTD2). `q` is trimmed, and blank is no search. `order` is always set, from the sort
 * column's first direction when not sent. The service appends its unique tiebreak column to the order (R12).
 */
export function numberedQuerySchema<const C extends string, F extends z.ZodRawShape>(
  config: NumberedQueryConfig<C, F>,
) {
  const firstOrders = new Map<string, SortOrder>(Object.entries(config.sort));
  const columns = Object.keys(config.sort).filter((key): key is C => firstOrders.has(key));
  return z
    .object({
      limit: limitSchema,
      offset: z.coerce.number().int().min(0).default(0),
      q: z
        .string()
        .trim()
        .transform((q) => q || undefined)
        .optional(),
      sort: z.enum(columns).default(config.defaultSort),
      order: z.enum(SORT_ORDERS).optional(),
    })
    .extend(config.filters)
    .transform((query) => ({ ...query, order: orderFor(query, firstOrders) }));
}

export type NumberedQuery<C extends string, F extends z.ZodRawShape> = z.output<
  ReturnType<typeof numberedQuerySchema<C, F>>
>;

/**
 * A cursor list's query (KTD3), with any per-endpoint fields (`{}` for none). `before` reads older than that id,
 * `after` newer, neither the newest; both together are refused.
 */
export function cursorQuerySchema<F extends z.ZodRawShape>(fields: F) {
  return z
    .object({ limit: limitSchema, before: cursorSchema.optional(), after: cursorSchema.optional() })
    .extend(fields)
    .refine(({ before, after }: { before?: number; after?: number }) => before === undefined || after === undefined, {
      message: 'Send before or after, not both',
      path: ['after'],
    });
}

export type CursorQuery<F extends z.ZodRawShape> = z.output<ReturnType<typeof cursorQuerySchema<F>>>;

/** `{ items, total, limit, offset }`: `offset` is the one used, after clamping (R14). */
export function numberedPageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.int().nonnegative(),
    limit: z.int().positive(),
    offset: z.int().nonnegative(),
  });
}

/** `{ items, older, newer }`: each the id to pass as `before` or `after`, or null at that end (KTD3). */
export function cursorPageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    older: z.int().positive().nullable(),
    newer: z.int().positive().nullable(),
  });
}

/** The offset to answer with: the last page's when `offset` is past the end, 0 when there are no rows (R14). */
export function clampOffset(offset: number, limit: number, total: number): number {
  if (offset < total) return offset;
  return Math.max(0, Math.ceil(total / limit) - 1) * limit;
}

/** The query as a LIKE pattern matching it literally anywhere: `\`, `%` and `_` escaped (KTD4). */
export function containsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
