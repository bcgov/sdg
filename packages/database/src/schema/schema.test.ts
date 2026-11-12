import { is } from 'drizzle-orm';
import { CasingCache, toSnakeCase } from 'drizzle-orm/casing';
import { getTableConfig, IndexedColumn, type Index, type PgColumn } from 'drizzle-orm/pg-core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  identities,
  principals,
  SERVICE_CLIENT_ACTIONS,
  serviceClientEvents,
  serviceClients,
  type Identity,
  type NewPrincipal,
  type Principal,
  type ServiceClient,
  type ServiceClientEvent,
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

describe('database schema', () => {
  it('puts every table in the core schema', () => {
    const tables = [principals, identities, serviceClients, serviceClientEvents];
    expect(tables.map((table) => getTableConfig(table).schema)).toEqual(['core', 'core', 'core', 'core']);
  });

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

  describe('service_clients', () => {
    const config = getTableConfig(serviceClients);
    const columns = byName(config.columns);

    it('is keyed by the Keycloak client id, with a display name, an enabled flag and timestamps', () => {
      expect([...columns.keys()]).toEqual(['client_id', 'display_name', 'enabled', 'created_at', 'updated_at']);
      expect(columns.get('client_id')).toMatchObject({ primary: true, notNull: true, columnType: 'PgText' });
      expect(columns.get('display_name')?.notNull).toBe(true);
      expect(columns.get('enabled')).toMatchObject({ notNull: true, default: true, columnType: 'PgBoolean' });
      expect(columns.get('updated_at')?.onUpdateFn).toBeTypeOf('function');
      expectTypeOf<ServiceClient>().toEqualTypeOf<{
        clientId: string;
        displayName: string;
        enabled: boolean;
        createdAt: Date;
        updatedAt: Date;
      }>();
    });
  });

  describe('service_client_events', () => {
    const config = getTableConfig(serviceClientEvents);
    const columns = byName(config.columns);

    it('records the client id, action, actor and time, with an identity id for ordering', () => {
      expect([...columns.keys()]).toEqual([
        'id',
        'client_id',
        'action',
        'actor_principal_id',
        'actor_name',
        'created_at',
      ]);
      expect(columns.get('id')).toMatchObject({ primary: true, columnType: 'PgBigInt53' });
      expect(columns.get('id')?.generatedIdentity?.type).toBe('always');
      for (const name of ['client_id', 'action', 'actor_principal_id', 'actor_name', 'created_at']) {
        expect(columns.get(name)?.notNull).toBe(true);
      }
      expectTypeOf<ServiceClientEvent['action']>().toEqualTypeOf<'added' | 'disabled' | 'enabled' | 'removed'>();
      expectTypeOf<ServiceClientEvent['id']>().toEqualTypeOf<number>();
    });

    it('has no foreign key, so history outlives the clients and principals it names', () => {
      expect(config.foreignKeys).toEqual([]);
    });

    it('allows only the known actions', () => {
      expect(SERVICE_CLIENT_ACTIONS).toEqual(['added', 'disabled', 'enabled', 'removed']);
      expect(config.checks.map((check) => check.name)).toEqual(['service_client_events_action_check']);
    });
  });
});
