import { is } from 'drizzle-orm';
import { CasingCache, toSnakeCase } from 'drizzle-orm/casing';
import { getTableConfig, IndexedColumn, type Index, type PgColumn } from 'drizzle-orm/pg-core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  identities,
  principals,
  sessions,
  type Identity,
  type NewPrincipal,
  type NewSession,
  type Principal,
} from './index.js';

// The client and drizzle-kit both use `casing: 'snake_case'`, so DB names are derived from the TS keys.
const casing = new CasingCache('snake_case');
const dbName = (column: PgColumn): string => casing.getColumnCasing(column);
const byName = (columns: PgColumn[]): Map<string, PgColumn> =>
  new Map(columns.map((column) => [dbName(column), column]));
const indexColumns = (index: Index | undefined): string[] =>
  (index?.config.columns ?? []).map((column) => {
    if (!is(column, IndexedColumn) || !column.name) return 'sql';
    return column.keyAsName ? toSnakeCase(column.name) : column.name;
  });

describe('portal-database schema', () => {
  describe('principals', () => {
    const config = getTableConfig(principals);
    const columns = byName(config.columns);

    it('has uuid id, display_name, email, created_at, updated_at, last_login_at in snake_case', () => {
      expect(config.name).toBe('principals');
      expect([...columns.keys()]).toEqual(['id', 'display_name', 'email', 'created_at', 'updated_at', 'last_login_at']);
      expect(columns.get('id')).toMatchObject({ primary: true, hasDefault: true, columnType: 'PgUUID' });
      for (const name of ['created_at', 'updated_at', 'last_login_at']) {
        expect(columns.get(name)?.getSQLType()).toBe('timestamp with time zone');
      }
      expect(columns.get('updated_at')?.onUpdateFn).toBeTypeOf('function');
    });

    it('requires display_name and allows a null email', () => {
      expect(columns.get('display_name')?.notNull).toBe(true);
      expect(columns.get('email')?.notNull).toBe(false);
      expect(columns.get('last_login_at')?.notNull).toBe(false);
      expectTypeOf<Principal['email']>().toEqualTypeOf<string | null>();
      expectTypeOf<Principal['displayName']>().toEqualTypeOf<string>();
      expectTypeOf<NewPrincipal>().toEqualTypeOf<{
        id?: string;
        displayName: string;
        email?: string | null;
        createdAt?: Date;
        updatedAt?: Date;
        lastLoginAt?: Date | null;
      }>();
    });
  });

  describe('identities', () => {
    const config = getTableConfig(identities);
    const columns = byName(config.columns);

    it('has a unique (issuer, subject) index named identities_issuer_subject_key', () => {
      const index = config.indexes.find((candidate) => candidate.config.name === 'identities_issuer_subject_key');
      expect(index?.config.unique).toBe(true);
      expect(indexColumns(index)).toEqual(['issuer', 'subject']);
      expect(columns.get('issuer')?.notNull).toBe(true);
      expect(columns.get('subject')?.notNull).toBe(true);
    });

    it('references principals.id with ON DELETE CASCADE', () => {
      expect(config.foreignKeys).toHaveLength(1);
      const [foreignKey] = config.foreignKeys;
      const reference = foreignKey?.reference();
      expect(reference?.columns.map(dbName)).toEqual(['principal_id']);
      expect(reference?.foreignTable).toBe(principals);
      expect(reference?.foreignColumns.map(dbName)).toEqual(['id']);
      expect(foreignKey?.onDelete).toBe('cascade');
      expect(columns.get('principal_id')?.notNull).toBe(true);
    });

    it('indexes principal_id', () => {
      const index = config.indexes.find((candidate) => candidate.config.name === 'identities_principal_id_idx');
      expect(index?.config.unique).toBe(false);
      expect(indexColumns(index)).toEqual(['principal_id']);
    });

    it('defaults claims to {} and email_verified to false', () => {
      expect(columns.get('claims')).toMatchObject({ notNull: true, default: {}, columnType: 'PgJsonb' });
      expect(columns.get('email_verified')).toMatchObject({ notNull: true, default: false, columnType: 'PgBoolean' });
      expect(columns.get('updated_at')?.onUpdateFn).toBeTypeOf('function');
      expectTypeOf<Identity['claims']>().toEqualTypeOf<Record<string, unknown>>();
      expectTypeOf<Identity['emailVerified']>().toEqualTypeOf<boolean>();
    });
  });

  describe('sessions', () => {
    const config = getTableConfig(sessions);
    const columns = byName(config.columns);

    it('has text sid primary key, sess and expires_at, all required', () => {
      expect(config.name).toBe('sessions');
      expect([...columns.keys()]).toEqual(['sid', 'sess', 'expires_at']);
      expect(columns.get('sid')).toMatchObject({ primary: true, hasDefault: false, columnType: 'PgText' });
      expect(columns.get('expires_at')?.getSQLType()).toBe('timestamp with time zone');
      for (const column of columns.values()) expect(column.notNull).toBe(true);
      expectTypeOf<NewSession>().toEqualTypeOf<{ sid: string; sess: string; expiresAt: Date }>();
    });

    it('indexes expires_at for pruning', () => {
      const index = config.indexes.find((candidate) => candidate.config.name === 'sessions_expires_at_idx');
      expect(index?.config.unique).toBe(false);
      expect(indexColumns(index)).toEqual(['expires_at']);
    });
  });
});
