import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * express-session store table. `sess` is encrypted by the app; it holds OIDC tokens. Unqualified, so it resolves to
 * the connecting login's own schema (`portal`) through Postgres's default search_path.
 *
 * Interim home until bff-core owns the sessions schema and its migrations (plan U4, U6): nothing in production
 * creates this table yet; tests create it with `SESSIONS_TABLE_SQL` (src/testing/database.ts).
 */
export const sessions = pgTable(
  'sessions',
  {
    sid: text().primaryKey(),
    sess: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_expires_at_idx').on(table.expiresAt)],
);
