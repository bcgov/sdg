import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import type { IsPrimaryKey, NotNull, PgTableOf, TextColumn, TimestamptzColumn } from './column-types.js';

export type SessionsTable = PgTableOf<
  'sessions',
  {
    sid: IsPrimaryKey<NotNull<TextColumn>>;
    sess: NotNull<TextColumn>;
    expiresAt: NotNull<TimestamptzColumn>;
  }
>;

/** express-session store for portal-api. `sess` is encrypted by the app; it holds OIDC tokens. */
export const sessions: SessionsTable = pgTable(
  'sessions',
  {
    sid: text().primaryKey(),
    sess: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_expires_at_idx').on(table.expiresAt)],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
