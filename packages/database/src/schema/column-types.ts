// Explicit table types for the `core` schema. `isolatedDeclarations` cannot infer Drizzle's builder chains, so each
// table declares its column map with these aliases; `coreSchema.table(...)` must still be assignable to it.
import type { BuildColumns, HasDefault, IsIdentity, IsPrimaryKey, NotNull } from 'drizzle-orm';
import type {
  PgBigInt53BuilderInitial,
  PgBooleanBuilderInitial,
  PgColumnBuilderBase,
  PgJsonbBuilderInitial,
  PgTableWithColumns,
  PgTextBuilderInitial,
  PgTimestampBuilderInitial,
  PgUUIDBuilderInitial,
} from 'drizzle-orm/pg-core';

export type UuidColumn = PgUUIDBuilderInitial<''>;
export type BigIntColumn = PgBigInt53BuilderInitial<''>;
export type TextColumn = PgTextBuilderInitial<'', [string, ...string[]]>;
export type BooleanColumn = PgBooleanBuilderInitial<''>;
export type JsonbColumn = PgJsonbBuilderInitial<''>;
export type TimestamptzColumn = PgTimestampBuilderInitial<''>;

/** `uuid primary key default gen_random_uuid()` */
export type UuidPrimaryKey = HasDefault<IsPrimaryKey<NotNull<UuidColumn>>>;
/** `timestamptz not null default now()` */
export type TimestamptzDefaultNow = HasDefault<NotNull<TimestamptzColumn>>;

/** A table in the `core` schema. */
export type PgTableOf<TName extends string, TColumns extends Record<string, PgColumnBuilderBase>> = PgTableWithColumns<{
  name: TName;
  schema: 'core';
  columns: BuildColumns<TName, TColumns, 'pg'>;
  dialect: 'pg';
}>;

export type { HasDefault, IsIdentity, IsPrimaryKey, NotNull };
