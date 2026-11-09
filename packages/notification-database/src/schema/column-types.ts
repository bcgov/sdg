// Explicit table types. `isolatedDeclarations` cannot infer Drizzle's builder chains, so each table
// declares its column map with these aliases; `notification.table(...)` must still be assignable to it.
import type { $Type, BuildColumns, HasDefault, IsPrimaryKey, NotNull } from 'drizzle-orm';
import type {
  PgBooleanBuilderInitial,
  PgColumnBuilderBase,
  PgIntegerBuilderInitial,
  PgJsonbBuilderInitial,
  PgTableWithColumns,
  PgTextBuilderInitial,
  PgTimestampBuilderInitial,
  PgUUIDBuilderInitial,
} from 'drizzle-orm/pg-core';

import type { NOTIFICATION_SCHEMA } from './pg-schema.js';

export type UuidColumn = PgUUIDBuilderInitial<''>;
export type TextColumn = PgTextBuilderInitial<'', [string, ...string[]]>;
export type BooleanColumn = PgBooleanBuilderInitial<''>;
export type IntegerColumn = PgIntegerBuilderInitial<''>;
export type JsonbColumn = PgJsonbBuilderInitial<''>;
export type TimestamptzColumn = PgTimestampBuilderInitial<''>;
/** `text[]` */
export type TextArrayColumn = ReturnType<TextColumn['array']>;
/** `uuid[]` */
export type UuidArrayColumn = ReturnType<UuidColumn['array']>;

/** `uuid primary key default gen_random_uuid()` */
export type UuidPrimaryKey = HasDefault<IsPrimaryKey<NotNull<UuidColumn>>>;
/** `timestamptz not null default now()` */
export type TimestamptzDefaultNow = HasDefault<NotNull<TimestamptzColumn>>;
/** `text primary key` */
export type TextPrimaryKey = IsPrimaryKey<NotNull<TextColumn>>;
/** `uuid not null`, usually a foreign key */
export type UuidReference = NotNull<UuidColumn>;
/** `integer not null default …` */
export type IntegerDefault = HasDefault<NotNull<IntegerColumn>>;
/** `text not null` holding `T` */
export type TextOf<T> = NotNull<$Type<TextColumn, T>>;
/** `jsonb not null` holding `T` */
export type JsonbOf<T> = NotNull<$Type<JsonbColumn, T>>;

/** A table in the `notification` Postgres schema. */
export type NotificationTable<
  TName extends string,
  TColumns extends Record<string, PgColumnBuilderBase>,
> = PgTableWithColumns<{
  name: TName;
  schema: typeof NOTIFICATION_SCHEMA;
  columns: BuildColumns<TName, TColumns, 'pg'>;
  dialect: 'pg';
}>;

export type { $Type, HasDefault, IsPrimaryKey, NotNull };
