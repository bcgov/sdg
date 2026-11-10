import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import manifest from '../package.json' with { type: 'json' };
import { createDatabase, identities, migrationsFolder, migrationsSchema, principals } from './index.js';
import * as schemaEntry from './schema/index.js';

const DATABASE_URL = 'postgres://portal:portal@localhost:5432/portal';
/** createDatabase options for tests that never see an idle client fail. */
const options = { onIdleClientError: vi.fn<(error: Error) => void>() };

const srcDir = dirname(fileURLToPath(import.meta.url));

/** Bare module specifiers reachable from `entry` through its relative imports (type-only imports included). */
function externalImports(entry: string, seen: Set<string> = new Set()): Set<string> {
  const external = new Set<string>();
  if (seen.has(entry)) return external;
  seen.add(entry);
  const source = readFileSync(entry, 'utf8');
  for (const [, specifier = ''] of source.matchAll(/(?:from|import)\s+'([^']+)'/g)) {
    const found = specifier.startsWith('.')
      ? externalImports(resolve(dirname(entry), specifier.replace(/\.js$/, '.ts')), seen)
      : [specifier];
    for (const name of found) external.add(name);
  }
  return external;
}

describe('database package', () => {
  describe('package.json', () => {
    it('exposes only the ., ./schema and ./testing subpaths', () => {
      expect(Object.keys(manifest.exports).toSorted()).toEqual(['.', './schema', './testing']);
      expect(manifest.exports['.']).toEqual({ types: './dist/index.d.ts', import: './dist/index.js' });
      expect(manifest.exports['./schema']).toEqual({
        types: './dist/schema/index.d.ts',
        import: './dist/schema/index.js',
      });
      expect(manifest.exports['./testing']).toEqual({
        types: './dist/testing/index.d.ts',
        import: './dist/testing/index.js',
      });
      expect(Object.keys(schemaEntry).toSorted()).toEqual(['identities', 'principals']);
    });

    it('peers drizzle-orm and depends on it and pg via the catalog', () => {
      // drizzle-orm is also a dependency so the migrate entry runs from a --prod deploy (the image).
      expect(manifest.peerDependencies).toEqual({ 'drizzle-orm': 'catalog:' });
      expect(manifest.dependencies).toEqual({ 'drizzle-orm': 'catalog:', pg: 'catalog:' });
      expect(manifest.files).toEqual(['dist', 'migrations']);
    });
  });

  describe('entry points', () => {
    it('the main and schema entries pull in only drizzle-orm, pg and node builtins (no Nest, no test helpers)', () => {
      for (const entry of ['index.ts', 'schema/index.ts']) {
        const imports = [...externalImports(join(srcDir, entry))];
        expect(imports.filter((name) => !/^(drizzle-orm(\/.*)?|pg|node:.*)$/.test(name))).toEqual([]);
      }
      expect([...externalImports(join(srcDir, 'index.ts'))]).toContain('pg');
    });

    it('the main entry does not reach the testing helpers', () => {
      const seen = new Set<string>();
      externalImports(join(srcDir, 'index.ts'), seen);
      expect([...seen].filter((file) => file.startsWith(join(srcDir, 'testing')))).toEqual([]);
      expect(seen.has(join(srcDir, 'client.ts'))).toBe(true);
    });
  });

  describe('migrationsFolder', () => {
    it('points at the committed drizzle-kit migrations', () => {
      expect(migrationsFolder).toMatch(/packages[\\/]database[\\/]migrations$/);
      expect(existsSync(join(migrationsFolder, 'meta/_journal.json'))).toBe(true);
      expect(existsSync(join(migrationsFolder, '0000_baseline.sql'))).toBe(true);
    });

    it('keeps the journal in the core schema', () => {
      expect(migrationsSchema).toBe('core');
    });
  });

  describe('createDatabase', () => {
    it('returns a drizzle database whose $client is a pg Pool', async () => {
      // pg.Pool connects lazily, so no database is needed.
      const db = createDatabase(DATABASE_URL, options);
      try {
        expect(db.$client).toBeInstanceOf(Pool);
        expect(db.$client.options.connectionString).toBe(DATABASE_URL);
        expect(db.$client.totalCount).toBe(0);
      } finally {
        await db.$client.end();
      }
    });

    it('accepts a PoolConfig object', async () => {
      const db = createDatabase({ host: 'localhost', database: 'portal', max: 3 }, options);
      try {
        expect(db.$client).toBeInstanceOf(Pool);
        expect(db.$client.options).toMatchObject({ host: 'localhost', database: 'portal', max: 3 });
      } finally {
        await db.$client.end();
      }
    });

    it("hands an idle client's error to onIdleClientError instead of crashing the process", async () => {
      const onIdleClientError = vi.fn<(error: Error) => void>();
      const db = createDatabase(DATABASE_URL, { onIdleClientError });
      const dropped = new Error('terminating connection due to administrator command');
      try {
        // pg emits this when Postgres closes an idle pooled connection (restart, Patroni switchover).
        expect(() => db.$client.emit('error', dropped)).not.toThrow();
        expect(onIdleClientError).toHaveBeenCalledExactlyOnceWith(dropped);
      } finally {
        await db.$client.end();
      }
    });

    it('exposes the principals and identities tables on db.query', async () => {
      const db = createDatabase(DATABASE_URL, options);
      try {
        expect(Object.keys(db.query).toSorted()).toEqual(['identities', 'principals']);
        // Builds SQL without connecting: the relational API knows both tables and the snake_case casing.
        expect(db.query.principals.findFirst().toSQL().sql).toMatch(
          /from "core"\."principals".*"display_name"|"display_name".*from "core"\."principals"/s,
        );
        expect(db.query.identities.findMany().toSQL().sql).toContain('"principal_id"');
        expect(db._.fullSchema).toMatchObject({ principals, identities });
      } finally {
        await db.$client.end();
      }
    });
  });
});
