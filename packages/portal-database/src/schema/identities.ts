import type { $Type } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import type {
  BooleanColumn,
  HasDefault,
  JsonbColumn,
  NotNull,
  PgTableOf,
  TextColumn,
  TimestamptzColumn,
  TimestamptzDefaultNow,
  UuidColumn,
  UuidPrimaryKey,
} from './column-types.js';
import { principals } from './principals.js';

/** Decoded ID-token claims. Never access, refresh or ID tokens. */
export type IdentityClaims = Record<string, unknown>;

export type IdentitiesTable = PgTableOf<
  'identities',
  {
    id: UuidPrimaryKey;
    principalId: NotNull<UuidColumn>;
    issuer: NotNull<TextColumn>;
    subject: NotNull<TextColumn>;
    email: TextColumn;
    emailVerified: HasDefault<NotNull<BooleanColumn>>;
    username: TextColumn;
    claims: HasDefault<NotNull<$Type<JsonbColumn, IdentityClaims>>>;
    createdAt: TimestamptzDefaultNow;
    updatedAt: TimestamptzDefaultNow;
    lastLoginAt: TimestamptzColumn;
  }
>;

/** One external IdP account (OIDC issuer + subject) linked to a principal. */
export const identities: IdentitiesTable = pgTable(
  'identities',
  {
    id: uuid().primaryKey().defaultRandom(),
    principalId: uuid()
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    issuer: text().notNull(),
    subject: text().notNull(),
    email: text(),
    emailVerified: boolean().notNull().default(false),
    username: text(),
    claims: jsonb().$type<IdentityClaims>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    lastLoginAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('identities_issuer_subject_key').on(table.issuer, table.subject),
    index('identities_principal_id_idx').on(table.principalId),
  ],
);

export type Identity = typeof identities.$inferSelect;
export type NewIdentity = typeof identities.$inferInsert;
