import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import manifest from '../package.json' with { type: 'json' };

const srcDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(srcDir, '..');
const ENTRIES = ['index', 'migrations/index', 'nestjs/index'];
const NEST_PEERS = ['@nestjs/common', '@nestjs/core', '@nestjs/swagger', 'reflect-metadata', 'rxjs'];
const NEST_IMPORT = /^(@nestjs\/|reflect-metadata|rxjs)/;

/** A module and every local module it imports statically (relative `from '…'` / `from "…"` specifiers). */
function staticGraph(
  entry: string,
  resolve: (specifier: string) => string = (s) => s.replace(/\.js$/, '.ts'),
): Set<string> {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop() ?? '';
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/from ['"](\.[^'"]+)['"]/g)) {
      pending.push(join(dirname(file), resolve(specifier ?? '')));
    }
  }
  return seen;
}

/** Bare specifiers statically imported by the given files (type-only imports included). */
function bareImports(files: Iterable<string>): string[] {
  const specifiers = new Set<string>();
  for (const file of files) {
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/from ['"]([^'".][^'"]*)['"]/g)) {
      specifiers.add(specifier ?? '');
    }
  }
  return [...specifiers].toSorted();
}

/** Runs the given bin and returns the output. */
function runBin(name: 'vite' | 'tsc', args: string[]) {
  const script =
    name === 'vite'
      ? join(packageDir, 'node_modules/vite/bin/vite.js')
      : join(packageDir, 'node_modules/typescript/bin/tsc');
  return execFileSync(process.execPath, [script, ...args], { cwd: packageDir });
}

describe('bff-core package', () => {
  describe('package.json', () => {
    it('exposes the ., ./migrations and ./nestjs subpaths and ships the migrations', () => {
      expect(Object.keys(manifest.exports).toSorted()).toEqual(['.', './migrations', './nestjs']);
      for (const [subpath, entry] of Object.entries(manifest.exports)) {
        const base = subpath === '.' ? 'index' : `${subpath.slice(2)}/index`;
        expect(entry).toEqual({ types: `./dist/${base}.d.ts`, import: `./dist/${base}.js` });
      }
      expect(manifest.files).toEqual(['dist', 'migrations']);
    });

    it('marks the Nest peers optional and depends on server-core and auth', () => {
      expect(Object.keys(manifest.peerDependencies).toSorted()).toEqual([...NEST_PEERS, 'drizzle-orm'].toSorted());
      expect(manifest.peerDependenciesMeta).toEqual(
        Object.fromEntries(NEST_PEERS.map((peer) => [peer, { optional: true }])),
      );
      expect(manifest.dependencies).toMatchObject({ '@repo/auth': 'workspace:*', '@repo/server-core': 'workspace:*' });
    });
  });

  describe('sources', () => {
    it.each(['index.ts', 'migrations/index.ts'])('keeps %s free of Nest', (entry) => {
      const graph = staticGraph(join(srcDir, entry));
      expect([...graph].some((file) => relative(srcDir, file).startsWith('nestjs'))).toBe(false);
      expect(bareImports(graph).filter((name) => NEST_IMPORT.test(name))).toEqual([]);
    });
  });
});

describe('build output', () => {
  let outDir = '';

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'bff-core-build-'));
    runBin('vite', ['build', '--outDir', outDir, '--logLevel', 'error']);
    runBin('tsc', ['-p', 'tsconfig.build.json', '--outDir', outDir]);
  }, 120_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  const builtGraph = (entry: string) => staticGraph(join(outDir, `${entry}.js`), (specifier) => specifier);

  it('emits JS and declarations for every entry, without tests or test support', () => {
    for (const entry of ENTRIES) {
      expect(existsSync(join(outDir, `${entry}.js`))).toBe(true);
      expect(existsSync(join(outDir, `${entry}.d.ts`))).toBe(true);
    }
    expect(existsSync(join(outDir, 'package-exports.test.d.ts'))).toBe(false);
    expect(existsSync(join(outDir, 'test-support'))).toBe(false);
  });

  it('keeps the core and migrations entries free of Nest', () => {
    for (const entry of ['index', 'migrations/index']) {
      expect(bareImports(builtGraph(entry)).filter((name) => NEST_IMPORT.test(name))).toEqual([]);
    }
  });

  it('resolves the migrations folder from dist/migrations/ to the package migrations/', () => {
    const built = readFileSync(join(outDir, 'migrations/index.js'), 'utf8');
    expect(built).toMatch(/new URL\("\.\.\/\.\.\/migrations", "" \+ import\.meta\.url\)/);
    expect(existsSync(join(packageDir, 'migrations/meta/_journal.json'))).toBe(true);
  });

  it('transforms the legacy decorators and bundles the Oxc helpers', () => {
    const nest = readFileSync(join(outDir, 'nestjs/index.js'), 'utf8');
    expect(bareImports(builtGraph('nestjs/index')).filter((name) => name.startsWith('@oxc-project'))).toEqual([]);
    expect(nest).not.toMatch(/^\s*@(Module|Injectable|Inject|Controller)\b/m);
    expect(nest).toMatch(/Inject\(BFF_OPTIONS\)/);
  });
});
