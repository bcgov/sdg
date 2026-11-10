import type { BuildColumns, IsPrimaryKey, NotNull } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  type PgTableWithColumns,
  type PgTextBuilderInitial,
  type PgTimestampBuilderInitial,
} from 'drizzle-orm/pg-core';

type TextColumn = PgTextBuilderInitial<'', [string, ...string[]]>;
type TimestamptzColumn = PgTimestampBuilderInitial<''>;

// `isolatedDeclarations` cannot infer Drizzle's builder chains, so the table's type is spelled out.
type SessionsColumns = {
  sid: IsPrimaryKey<NotNull<TextColumn>>;
  sess: NotNull<TextColumn>;
  expiresAt: NotNull<TimestamptzColumn>;
  destroyedAt: TimestamptzColumn;
};

export type SessionsTable = PgTableWithColumns<{
  name: 'sessions';
  schema: undefined;
  columns: BuildColumns<'sessions', SessionsColumns, 'pg'>;
  dialect: 'pg';
}>;

/**
 * express-session store table, one per BFF. `sess` is encrypted by the store; it holds OIDC tokens. Unqualified, so it
 * resolves to the connecting login's own schema (`portal`, `admin`) through Postgres's default search_path (KTD8).
 * `destroyed_at` marks a tombstone: the session ended and no later save may bring it back (KTD7). The prune job
 * (migrations/0000_sessions.sql) deletes expired rows, tombstones included.
 */
export const sessions: SessionsTable = pgTable(
  'sessions',
  {
    sid: text().primaryKey(),
    sess: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    destroyedAt: timestamp({ withTimezone: true }),
  },
  (table) => [index('sessions_expires_at_idx').on(table.expiresAt)],
);
