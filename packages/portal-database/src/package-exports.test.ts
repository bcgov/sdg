import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import manifest from '../package.json' with { type: 'json' };
import { createPortalDatabase, identities, migrationsFolder, principals } from './index.js';
import * as schemaEntry from './schema/index.js';

describe('portal-database package', () => {
  describe('package.json', () => {
    it('exposes only the . and ./schema subpaths', () => {
      expect(Object.keys(manifest.exports).toSorted()).toEqual(['.', './schema']);
      expect(manifest.exports['.']).toEqual({ types: './dist/index.d.ts', import: './dist/index.js' });
      expect(manifest.exports['./schema']).toEqual({
        types: './dist/schema/index.d.ts',
        import: './dist/schema/index.js',
      });
      expect(Object.keys(schemaEntry).toSorted()).toEqual(['identities', 'principals', 'sessions']);
    });

    it('peers drizzle-orm and depends on it and pg via the catalog', () => {
      // drizzle-orm is also a dependency so the migrate entry runs from a --prod deploy (the image).
      expect(manifest.peerDependencies).toEqual({ 'drizzle-orm': 'catalog:' });
      expect(manifest.dependencies).toEqual({ 'drizzle-orm': 'catalog:', pg: 'catalog:' });
      expect(manifest.files).toEqual(['dist', 'migrations']);
    });
  });

  describe('migrationsFolder', () => {
    it('points at the committed drizzle-kit migrations', () => {
      expect(migrationsFolder).toMatch(/portal-database[\\/]migrations$/);
      expect(existsSync(join(migrationsFolder, 'meta/_journal.json'))).toBe(true);
      expect(existsSync(join(migrationsFolder, '0000_init.sql'))).toBe(true);
    });
  });

  describe('createPortalDatabase', () => {
    it('returns a drizzle database whose $client is a pg Pool', async () => {
      // pg.Pool connects lazily, so no database is needed.
      const db = createPortalDatabase('postgres://portal:portal@localhost:5432/portal');
      try {
        expect(db.$client).toBeInstanceOf(Pool);
        expect(db.$client.options.connectionString).toBe('postgres://portal:portal@localhost:5432/portal');
        expect(db.$client.totalCount).toBe(0);
      } finally {
        await db.$client.end();
      }
    });

    it('accepts a PoolConfig object', async () => {
      const db = createPortalDatabase({ host: 'localhost', database: 'portal', max: 3 });
      try {
        expect(db.$client).toBeInstanceOf(Pool);
        expect(db.$client.options).toMatchObject({ host: 'localhost', database: 'portal', max: 3 });
      } finally {
        await db.$client.end();
      }
    });

    it('exposes the principals, identities and sessions tables on db.query', async () => {
      const db = createPortalDatabase('postgres://portal:portal@localhost:5432/portal');
      try {
        expect(Object.keys(db.query).toSorted()).toEqual(['identities', 'principals', 'sessions']);
        // Builds SQL without connecting: the relational API knows both tables and the snake_case casing.
        expect(db.query.principals.findFirst().toSQL().sql).toMatch(
          /from "principals".*"display_name"|"display_name".*from "principals"/s,
        );
        expect(db.query.identities.findMany().toSQL().sql).toContain('"principal_id"');
        expect(db._.fullSchema).toMatchObject({ principals, identities });
      } finally {
        await db.$client.end();
      }
    });
  });
});
