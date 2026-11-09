import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

/** A table paged newest first by `(created_at, id)`. */
type PagedTable = PgTable & { createdAt: PgColumn; id: PgColumn };

/** Rows after the cursor's row in `(created_at, id)` descending order; undefined without a cursor. */
export function afterCursor(table: PagedTable, cursor: string | undefined): SQL | undefined {
  if (cursor === undefined) return undefined;
  // The table renders schema-qualified (`"notification"."deliveries"`).
  return sql`(${table.createdAt}, ${table.id}) < (SELECT c.created_at, c.id FROM ${table} c WHERE c.id = ${cursor})`;
}

/** The first `limit` of up to `limit + 1` rows, and the last one's id as the next cursor when there are more. */
export function toPage<T extends { id: string }>(rows: T[], limit: number): { page: T[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  return { page, nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
}
