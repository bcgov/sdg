import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build, type PluginOption } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

import { defineLibraryConfig, isExternal } from './library.ts';

const isNamedPlugin = (plugin: unknown): plugin is { name: string } =>
  typeof plugin === 'object' && plugin !== null && 'name' in plugin && typeof plugin.name === 'string';

const pluginNames = (plugins: PluginOption | PluginOption[]): string[] => {
  if (Array.isArray(plugins)) return plugins.flatMap((plugin) => pluginNames(plugin));
  return isNamedPlugin(plugins) ? [plugins.name] : [];
};

describe('isExternal', () => {
  it.each(['react', 'react/jsx-runtime', '@nestjs/core', 'node:fs'])('externalizes bare import %s', (id) => {
    expect(isExternal(id)).toBe(true);
  });

  it.each(['./util', '../shared', '/abs/path/file.ts', '\0virtual:module'])('bundles %s', (id) => {
    expect(isExternal(id)).toBe(false);
  });
});

describe('defineLibraryConfig', () => {
  it('builds ESM only with entry-named files', () => {
    const config = defineLibraryConfig({ entry: 'src/index.ts', platform: 'node' });
    const lib = config.build?.lib;
    expect(lib && lib.formats).toEqual(['es']);
    expect(lib && lib.entry).toBe('src/index.ts');
    expect(config.build?.target).toBe('node24');
  });

  it('adds the React plugin and a browser target for react libraries', () => {
    const config = defineLibraryConfig({ entry: 'src/index.ts', platform: 'react' });
    expect(pluginNames(config.plugins).some((name) => name.includes('react'))).toBe(true);
    expect(config.build?.target).not.toBe('node24');
  });

  it('adds no framework plugin and a browser target for browser libraries', () => {
    const config = defineLibraryConfig({ entry: 'src/index.ts', platform: 'browser' });
    expect(pluginNames(config.plugins)).toEqual([]);
    expect(config.build?.target).toBe('es2024');
  });

  it('merges overrides', () => {
    const config = defineLibraryConfig({
      entry: 'src/index.ts',
      platform: 'node',
      overrides: { build: { minify: true } },
    });
    expect(config.build?.minify).toBe(true);
    expect(config.build?.lib && config.build.lib.formats).toEqual(['es']);
  });

  describe('real build', () => {
    const root = mkdtempSync(join(tmpdir(), 'vite-config-lib-'));
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    it('inlines relative modules and leaves bare imports external', async () => {
      writeFileSync(join(root, 'util.ts'), 'export const twice = (n: number): number => n * 2;\n');
      writeFileSync(
        join(root, 'index.ts'),
        "import { readFileSync } from 'node:fs';\nimport { twice } from './util.ts';\nexport const run = (): number => twice(readFileSync.length);\n",
      );
      await build({
        ...defineLibraryConfig({ entry: join(root, 'index.ts'), platform: 'node' }),
        root,
        configFile: false,
        logLevel: 'silent',
      });
      const output = readFileSync(join(root, 'dist', 'index.js'), 'utf8');
      expect(output).toMatch(/from ["']node:fs["']/);
      expect(output).toContain('* 2');
      expect(output).not.toContain('./util');
    });
  });
});
