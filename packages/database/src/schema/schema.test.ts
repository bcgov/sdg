import { is } from 'drizzle-orm';
import { CasingCache, toSnakeCase } from 'drizzle-orm/casing';
import { getTableConfig, IndexedColumn, type Index, type PgColumn } from 'drizzle-orm/pg-core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  FEATURE_FLAG_AUDIENCES,
  FEATURE_FLAG_EVENT_ACTIONS,
  featureFlagEvents,
  featureFlagOverrides,
  featureFlags,
  identities,
  principals,
  SERVICE_CLIENT_ACTIONS,
  serviceClientEvents,
  serviceClients,
  type FeatureFlag,
  type FeatureFlagEvent,
  type FeatureFlagOverride,
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
  it('Should put every table, the feature-flag tables included, in the core schema', () => {
    const tables = [
      principals,
      identities,
      serviceClients,
      serviceClientEvents,
      featureFlags,
      featureFlagOverrides,
      featureFlagEvents,
    ];
    expect(tables.map((table) => `${getTableConfig(table).schema}.${getTableConfig(table).name}`)).toEqual([
      'core.principals',
      'core.identities',
      'core.service_clients',
      'core.service_client_events',
      'core.feature_flags',
      'core.feature_flag_overrides',
      'core.feature_flag_events',
    ]);
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

    it('Should record nullable portal and console sign-in times (KTD5)', () => {
      expect([...columns.keys()].slice(-2)).toEqual(['portal_signed_in_at', 'console_signed_in_at']);
      for (const name of ['portal_signed_in_at', 'console_signed_in_at']) {
        expect(columns.get(name)).toMatchObject({ notNull: false, hasDefault: false });
        expect(columns.get(name)?.getSQLType()).toBe('timestamp with time zone');
      }
      expectTypeOf<Identity['portalSignedInAt']>().toEqualTypeOf<Date | null>();
      expectTypeOf<Identity['consoleSignedInAt']>().toEqualTypeOf<Date | null>();
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

  describe('feature_flags', () => {
    const config = getTableConfig(featureFlags);
    const columns = byName(config.columns);

    it('Should key flags by text and default them off, at 100% and for the portal (R1, KTD6)', () => {
      expect([...columns.keys()]).toEqual(['key', 'description', 'enabled', 'rollout_pct', 'audience']);
      expect(columns.get('key')).toMatchObject({ primary: true, notNull: true, columnType: 'PgText' });
      expect(columns.get('description')?.notNull).toBe(false);
      expect(columns.get('enabled')).toMatchObject({ notNull: true, default: false, columnType: 'PgBoolean' });
      expect(columns.get('rollout_pct')).toMatchObject({ notNull: true, default: 100, columnType: 'PgSmallInt' });
      expect(columns.get('audience')).toMatchObject({ notNull: true, default: 'portal', columnType: 'PgText' });
      expectTypeOf<FeatureFlag>().toEqualTypeOf<{
        key: string;
        description: string | null;
        enabled: boolean;
        rolloutPct: number;
        audience: 'portal' | 'console' | 'both';
      }>();
    });

    it('Should check the rollout percentage and the audience', () => {
      expect(FEATURE_FLAG_AUDIENCES).toEqual(['portal', 'console', 'both']);
      expect(config.checks.map((check) => check.name)).toEqual([
        'feature_flags_rollout_pct_check',
        'feature_flags_audience_check',
      ]);
    });
  });

  describe('feature_flag_overrides', () => {
    const config = getTableConfig(featureFlagOverrides);
    const columns = byName(config.columns);

    it('Should key overrides by (flag_key, user_id) with a required on/off value', () => {
      expect([...columns.keys()]).toEqual(['flag_key', 'user_id', 'enabled']);
      expect(config.primaryKeys.map((key) => key.getName())).toEqual(['feature_flag_overrides_pkey']);
      expect(config.primaryKeys[0]?.columns.map(dbName)).toEqual(['flag_key', 'user_id']);
      for (const name of ['flag_key', 'user_id', 'enabled']) expect(columns.get(name)?.notNull).toBe(true);
      expect(columns.get('enabled')?.hasDefault).toBe(false);
      expectTypeOf<FeatureFlagOverride>().toEqualTypeOf<{ flagKey: string; userId: string; enabled: boolean }>();
    });

    it('Should cascade from both the flag and the principal (R17, KTD6)', () => {
      const references = config.foreignKeys.map((foreignKey) => {
        const reference = foreignKey.reference();
        return {
          columns: reference.columns.map(dbName),
          table: getTableConfig(reference.foreignTable).name,
          foreignColumns: reference.foreignColumns.map(dbName),
          onDelete: foreignKey.onDelete,
        };
      });
      expect(references).toEqual([
        { columns: ['flag_key'], table: 'feature_flags', foreignColumns: ['key'], onDelete: 'cascade' },
        { columns: ['user_id'], table: 'principals', foreignColumns: ['id'], onDelete: 'cascade' },
      ]);
    });
  });

  describe('feature_flag_events', () => {
    const config = getTableConfig(featureFlagEvents);
    const columns = byName(config.columns);

    it('Should record the action, flag key, actor, target, changes and time, ordered by an identity id (R19, KTD7)', () => {
      expect([...columns.keys()]).toEqual([
        'id',
        'flag_key',
        'action',
        'actor_principal_id',
        'actor_name',
        'subject_principal_id',
        'changes',
        'created_at',
      ]);
      expect(columns.get('id')?.generatedIdentity?.type).toBe('always');
      for (const name of ['flag_key', 'action', 'actor_principal_id', 'actor_name', 'changes', 'created_at']) {
        expect(columns.get(name)?.notNull).toBe(true);
      }
      expect(columns.get('subject_principal_id')).toMatchObject({ notNull: false, columnType: 'PgUUID' });
      expect(columns.get('changes')).toMatchObject({ default: {}, columnType: 'PgJsonb' });
      expectTypeOf<FeatureFlagEvent['action']>().toEqualTypeOf<
        'created' | 'updated' | 'deleted' | 'override_set' | 'override_removed'
      >();
      expectTypeOf<FeatureFlagEvent['subjectPrincipalId']>().toEqualTypeOf<string | null>();
      expectTypeOf<FeatureFlagEvent['changes']>().toEqualTypeOf<Record<string, unknown>>();
    });

    it('Should have no foreign key and allow only the known actions (KTD7)', () => {
      expect(config.foreignKeys).toEqual([]);
      expect(FEATURE_FLAG_EVENT_ACTIONS).toEqual(['created', 'updated', 'deleted', 'override_set', 'override_removed']);
      expect(config.checks.map((check) => check.name)).toEqual(['feature_flag_events_action_check']);
    });
  });
});
