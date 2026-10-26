import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const require = createRequire(import.meta.url);
const tscBin = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');

const tsc = (fixture: string, ...args: string[]) =>
  spawnSync(process.execPath, [tscBin, '-p', join(fixtures, fixture), ...args], {
    encoding: 'utf8',
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const showConfig = (fixture: string): Record<string, unknown> => {
  const result = tsc(fixture, '--showConfig');
  if (result.status !== 0) throw new Error(`tsc --showConfig failed for ${fixture}: ${result.stdout}${result.stderr}`);
  const parsed: unknown = JSON.parse(result.stdout);
  if (!isRecord(parsed) || !isRecord(parsed['compilerOptions'])) throw new Error(`No compilerOptions for ${fixture}`);
  return parsed['compilerOptions'];
};

const typecheckPresets = ['node', 'vite-react-app', 'node-library', 'react-library', 'browser-library', 'nestjs'];
const buildPresets = ['node-library-build', 'react-library-build', 'browser-library-build', 'nestjs-build'];
const presets = [...typecheckPresets, ...buildPresets];

afterAll(() => {
  for (const preset of presets) rmSync(join(fixtures, preset, 'dist'), { recursive: true, force: true });
});

describe('typescript presets', () => {
  it.each(presets)('%s compiles a fixture with TypeScript 7 and no diagnostics', (preset) => {
    const result = tsc(preset);
    expect(result.stdout + result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it.each(presets)('%s is strict and sets `types` explicitly', (preset) => {
    const compilerOptions = showConfig(preset);
    expect(compilerOptions['strict']).toBe(true);
    expect(Array.isArray(compilerOptions['types'])).toBe(true);
    expect(compilerOptions).not.toHaveProperty('baseUrl');
  });

  it.each(typecheckPresets)('%s type-checks root-level config files without emitting', (preset) => {
    const compilerOptions = showConfig(preset);
    expect(compilerOptions['noEmit']).toBe(true);
    expect(compilerOptions).not.toHaveProperty('rootDir');
    expect(compilerOptions).not.toHaveProperty('isolatedDeclarations');
  });

  it.each(['node-library-build', 'react-library-build', 'browser-library-build'])(
    '%s emits only declarations into the consumer dist',
    (preset) => {
      const dist = join(fixtures, preset, 'dist');
      expect(tsc(preset).status).toBe(0);
      expect(existsSync(join(dist, 'index.d.ts'))).toBe(true);
      expect(existsSync(join(dist, 'index.d.ts.map'))).toBe(true);
      expect(existsSync(join(dist, 'index.js'))).toBe(false);
    },
  );

  it('nestjs-build emits JS with decorator metadata into the consumer dist', () => {
    expect(tsc('nestjs-build').status).toBe(0);
    const output = readFileSync(join(fixtures, 'nestjs-build', 'dist', 'greeter.js'), 'utf8');
    expect(output).toContain('design:paramtypes');
    expect(output).toContain('Clock');
    expect(existsSync(join(fixtures, 'nestjs-build', 'dist', 'greeter.js.map'))).toBe(true);
  });

  it('vite-react-app targets the DOM with Vite client types', () => {
    const compilerOptions = showConfig('vite-react-app');
    expect(compilerOptions['jsx']).toBe('react-jsx');
    expect(compilerOptions['types']).toEqual(['vite/client']);
  });
});
