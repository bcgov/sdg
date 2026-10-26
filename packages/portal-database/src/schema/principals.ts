import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type {
  NotNull,
  PgTableOf,
  TextColumn,
  TimestamptzColumn,
  TimestamptzDefaultNow,
  UuidPrimaryKey,
} from './column-types.js';

export type PrincipalsTable = PgTableOf<
  'principals',
  {
    id: UuidPrimaryKey;
    displayName: NotNull<TextColumn>;
    email: TextColumn;
    createdAt: TimestamptzDefaultNow;
    updatedAt: TimestamptzDefaultNow;
    lastLoginAt: TimestamptzColumn;
  }
>;

/** A person/account in the portal. One principal can have many linked IdP identities. */
export const principals: PrincipalsTable = pgTable('principals', {
  id: uuid().primaryKey().defaultRandom(),
  displayName: text().notNull(),
  email: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  lastLoginAt: timestamp({ withTimezone: true }),
});

export type Principal = typeof principals.$inferSelect;
export type NewPrincipal = typeof principals.$inferInsert;
