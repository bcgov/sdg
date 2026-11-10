import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import manifest from '../package.json' with { type: 'json' };

const srcDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(srcDir, '..');
const ENTRIES = ['index', 'forwarding/index', 'nestjs/index', 'telemetry/index', 'testing/index'];
const PEERS = [
  '@nestjs/common',
  '@nestjs/config',
  '@nestjs/core',
  '@nestjs/platform-express',
  '@nestjs/swagger',
  '@nestjs/terminus',
  'nestjs-pino',
  'pino-http',
  'reflect-metadata',
  'rxjs',
];

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

/** Bare specifiers statically imported by the given files. */
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

describe('server-core package', () => {
  describe('package.json', () => {
    it('exposes the ., ./forwarding, ./nestjs, ./telemetry and ./testing subpaths', () => {
      expect(Object.keys(manifest.exports).toSorted()).toEqual([
        '.',
        './forwarding',
        './nestjs',
        './telemetry',
        './testing',
      ]);
      for (const [subpath, entry] of Object.entries(manifest.exports)) {
        const base = subpath === '.' ? 'index' : `${subpath.slice(2)}/index`;
        expect(entry).toEqual({ types: `./dist/${base}.d.ts`, import: `./dist/${base}.js` });
      }
    });

    it('marks the Nest peers optional', () => {
      expect(Object.keys(manifest.peerDependencies).toSorted()).toEqual(PEERS);
      expect(manifest.peerDependenciesMeta).toEqual(
        Object.fromEntries(PEERS.map((peer) => [peer, { optional: true }])),
      );
    });
  });

  describe('sources', () => {
    it.each(['index.ts', 'forwarding/index.ts', 'telemetry/index.ts', 'testing/index.ts'])(
      'keeps %s free of Nest',
      (entry) => {
        const graph = staticGraph(join(srcDir, entry));
        expect([...graph].some((file) => relative(srcDir, file).startsWith('nestjs'))).toBe(false);
        expect(
          bareImports(graph).filter((name) => /^(@nestjs\/|nestjs-pino|reflect-metadata|rxjs)/.test(name)),
        ).toEqual([]);
      },
    );

    it('keeps the forwarding entry on fetch alone', () => {
      expect(bareImports(staticGraph(join(srcDir, 'forwarding/index.ts')))).toEqual([]);
    });
  });
});

describe('build output', () => {
  let outDir = '';

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'server-core-build-'));
    runBin('vite', ['build', '--outDir', outDir, '--logLevel', 'error']);
    runBin('tsc', ['-p', 'tsconfig.build.json', '--outDir', outDir]);
  }, 120_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  const builtGraph = (entry: string) => staticGraph(join(outDir, `${entry}.js`), (specifier) => specifier);
  const prometheus = (entry: string) => [...builtGraph(entry)].filter((file) => /prometheus-[\w-]+\.js$/.test(file));

  it('emits JS and declarations for every entry, without test files', () => {
    for (const entry of ENTRIES) {
      expect(existsSync(join(outDir, `${entry}.js`))).toBe(true);
      expect(existsSync(join(outDir, `${entry}.d.ts`))).toBe(true);
    }
    expect(existsSync(join(outDir, 'env.test.d.ts'))).toBe(false);
  });

  it('loads the OpenTelemetry SDK only lazily from the telemetry entry, after the loader hooks', () => {
    const graph = builtGraph('telemetry/index');
    expect(bareImports(graph)).toEqual(['node:module', 'zod']);
    const entry = readFileSync(join(outDir, 'telemetry/index.js'), 'utf8');
    expect(entry).toMatch(/await import\("import-in-the-middle\/register-hooks\.mjs"\)/);
    expect(entry).toMatch(/await import\("\.\.\/otel-sdk-[\w-]+\.js"\)/);
  });

  it('shares one Prometheus exporter between the SDK and the /metrics middleware', () => {
    const [sdkChunk] = /otel-sdk-[\w-]+\.js/.exec(readFileSync(join(outDir, 'telemetry/index.js'), 'utf8')) ?? [];
    expect(prometheus('nestjs/index')).toHaveLength(1);
    expect(prometheus(sdkChunk?.replace(/\.js$/, '') ?? '')).toEqual(prometheus('nestjs/index'));
  });

  it('keeps the core and forwarding entries free of Nest', () => {
    expect(bareImports(builtGraph('index'))).toEqual(['zod']);
    expect(bareImports(builtGraph('forwarding/index'))).toEqual([]);
  });

  it('keeps the testing entry on Node built-ins', () => {
    expect(bareImports(builtGraph('testing/index'))).toEqual(['node:http']);
  });

  it('transforms the legacy decorators and bundles the Oxc helpers', () => {
    const nest = readFileSync(join(outDir, 'nestjs/index.js'), 'utf8');
    expect(bareImports(builtGraph('nestjs/index')).filter((name) => name.startsWith('@oxc-project'))).toEqual([]);
    expect(nest).not.toMatch(/^\s*@(Module|Injectable|Inject|Controller)\b/m);
    expect(nest).toMatch(/Inject\(READINESS_CHECKS\)/);
  });
});
