import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import manifest from '../package.json' with { type: 'json' };

const srcDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(srcDir, '..');
const NEST_PEERS = ['@nestjs/common', '@nestjs/core', 'reflect-metadata', 'rxjs'];

/** Collects the core entry and every local module it imports transitively. */
function coreModuleGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop() ?? '';
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(/from '(\.[^']+)'/g)) {
      pending.push(join(dirname(file), (specifier ?? '').replace(/\.js$/, '.ts')));
    }
  }
  return seen;
}

describe('auth package', () => {
  describe('package.json', () => {
    it('exposes only the . and ./nestjs subpaths', () => {
      expect(Object.keys(manifest.exports).toSorted()).toEqual(['.', './nestjs']);
      expect(manifest.exports['.']).toEqual({ types: './dist/index.d.ts', import: './dist/index.js' });
      expect(manifest.exports['./nestjs']).toEqual({
        types: './dist/nestjs/index.d.ts',
        import: './dist/nestjs/index.js',
      });
    });
    it('marks the Nest peers optional', () => {
      expect(Object.keys(manifest.peerDependencies).toSorted()).toEqual(NEST_PEERS);
      expect(manifest.peerDependenciesMeta).toEqual(
        Object.fromEntries(NEST_PEERS.map((peer) => [peer, { optional: true }])),
      );
      expect(Object.keys(manifest.dependencies).toSorted()).toEqual(['jose', 'openid-client']);
    });
  });
  describe('core entry', () => {
    it('does not import @nestjs/*', () => {
      const graph = coreModuleGraph(join(srcDir, 'index.ts'));
      const files = [...graph].map((file) => relative(srcDir, file));
      expect(files).toEqual(expect.arrayContaining(['index.ts', 'oidc-client.ts', 'jwt-verifier.ts', 'claims.ts']));
      expect(files.some((file) => file.startsWith('nestjs'))).toBe(false);
      for (const file of graph) {
        expect(readFileSync(file, 'utf8')).not.toMatch(/from '(@nestjs\/|reflect-metadata|rxjs)/);
      }
    });
    it('keeps every non-test source outside src/nestjs free of Nest imports', () => {
      const coreFiles = readdirSync(srcDir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
      expect(coreFiles.length).toBeGreaterThan(5);
      for (const name of coreFiles) {
        expect(readFileSync(join(srcDir, name), 'utf8')).not.toContain('@nestjs');
      }
    });
  });
});

/** Bare specifiers imported by a built JS file. */
function bareImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/from "([^".][^"]*)"/g)].map(([, specifier]) => specifier ?? '').toSorted();
}

describe('build output', () => {
  let outDir = '';

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'auth-build-'));
    const bin = (name: string): string => join(packageDir, 'node_modules/.bin', name);
    execFileSync(bin('vite'), ['build', '--outDir', outDir, '--logLevel', 'error'], { cwd: packageDir });
    execFileSync(bin('tsc'), ['-p', 'tsconfig.build.json', '--outDir', outDir], { cwd: packageDir });
  }, 120_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it('emits JS and declarations for both entries, without test files', () => {
    for (const entry of ['index', 'nestjs/index']) {
      expect(existsSync(join(outDir, `${entry}.js`))).toBe(true);
      expect(existsSync(join(outDir, `${entry}.d.ts`))).toBe(true);
    }
    expect(existsSync(join(outDir, 'claims.test.d.ts'))).toBe(false);
    expect(existsSync(join(outDir, 'test-support'))).toBe(false);
  });

  it('keeps dependencies external and the core entry free of Nest', () => {
    const shared = readdirSync(outDir).filter((name) => name.endsWith('.js') && name !== 'index.js');
    expect(shared.flatMap((name) => bareImports(join(outDir, name)))).toEqual(['jose', 'openid-client']);
    expect(bareImports(join(outDir, 'index.js'))).toEqual([]);
  });

  it('transforms the legacy decorators and bundles the Oxc helpers', () => {
    const nest = readFileSync(join(outDir, 'nestjs/index.js'), 'utf8');
    expect(bareImports(join(outDir, 'nestjs/index.js'))).toEqual(['@nestjs/common']);
    expect(nest).not.toMatch(/^\s*@(Module|Injectable|Inject)\b/m);
    expect(nest).toMatch(/Inject\(JWT_VERIFIER\)/);
  });
});
