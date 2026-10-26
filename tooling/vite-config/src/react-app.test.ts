import type { PluginOption } from 'vite';
import { describe, expect, it } from 'vitest';

import { defineReactAppConfig } from './react-app.ts';

const isNamedPlugin = (plugin: unknown): plugin is { name: string } =>
  typeof plugin === 'object' && plugin !== null && 'name' in plugin && typeof plugin.name === 'string';

const pluginNames = (plugins: PluginOption | PluginOption[]): string[] => {
  if (Array.isArray(plugins)) return plugins.flatMap((plugin) => pluginNames(plugin));
  return isNamedPlugin(plugins) ? [plugins.name] : [];
};

describe('defineReactAppConfig', () => {
  it('includes the React plugin and source maps by default', () => {
    const config = defineReactAppConfig();
    expect(pluginNames(config.plugins).some((name) => name.includes('react'))).toBe(true);
    expect(config.build?.sourcemap).toBe(true);
    expect(config.build?.lib).toBeUndefined();
  });

  it('deep-merges overrides without dropping defaults', () => {
    const config = defineReactAppConfig({ server: { port: 4000 }, build: { outDir: 'out' } });
    expect(config.server?.port).toBe(4000);
    expect(config.build?.outDir).toBe('out');
    expect(config.build?.sourcemap).toBe(true);
  });

  it('appends override plugins after the React plugin', () => {
    const config = defineReactAppConfig({ plugins: [{ name: 'custom' }] });
    const names = pluginNames(config.plugins);
    expect(names.at(-1)).toBe('custom');
    expect(names.length).toBeGreaterThan(1);
  });
});
