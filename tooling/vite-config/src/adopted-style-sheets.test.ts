import { runInNewContext } from 'node:vm';

import type { PluginOption } from 'vite';
import { describe, expect, it } from 'vitest';

import { adoptedStyleSheets, BCGOV_MODULE, rewriteStyleInject } from './adopted-style-sheets.ts';
import { defineReactAppConfig } from './react-app.ts';

const BCGOV_ID = `/repo/node_modules/.pnpm/x/node_modules/${BCGOV_MODULE}`;

// The shape rollup-plugin-postcss emits (as in @bcgov/design-system-react-components 0.9.x).
const bcgovModule = `import { jsx } from 'react/jsx-runtime';

function styleInject(css, ref) {
  if ( ref === void 0 ) ref = {};
  var insertAt = ref.insertAt;

  if (!css || typeof document === 'undefined') { return; }

  var head = document.head || document.getElementsByTagName('head')[0];
  var style = document.createElement('style');
  style.type = 'text/css';

  if (insertAt === 'top') {
    if (head.firstChild) {
      head.insertBefore(style, head.firstChild);
    } else {
      head.appendChild(style);
    }
  } else {
    head.appendChild(style);
  }

  if (style.styleSheet) {
    style.styleSheet.cssText = css;
  } else {
    style.appendChild(document.createTextNode(css));
  }
}

var css_248z$1 = ".a { color: red; }";
styleInject(css_248z$1);

var css_248z = ".b { color: blue; }";
styleInject(css_248z);

export { styleInject as __test };
`;

const transform = rewriteStyleInject;

const isNamedPlugin = (plugin: unknown): plugin is { name: string } =>
  typeof plugin === 'object' && plugin !== null && 'name' in plugin && typeof plugin.name === 'string';

const pluginNames = (plugins: PluginOption | PluginOption[]): string[] => {
  if (Array.isArray(plugins)) return plugins.flatMap((plugin) => pluginNames(plugin));
  return isNamedPlugin(plugins) ? [plugins.name] : [];
};

/** Runs the transformed module's styleInject calls against a minimal document. */
function runInFakeDocument(code: string) {
  class FakeSheet {
    cssText = '';
    replaceSync(css: string) {
      this.cssText = css;
    }
  }
  const document = { adoptedStyleSheets: [] as FakeSheet[], createElement: () => ({}) };
  const body = code.replace(/^import .*$/m, '').replace(/^export .*$/m, '');
  runInNewContext(body, { document, CSSStyleSheet: FakeSheet });
  return document;
}

describe('adoptedStyleSheets plugin', () => {
  it('only applies to builds, before other transforms', () => {
    const plugin = adoptedStyleSheets();
    expect(plugin.name).toBe('sdg:adopted-style-sheets');
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('pre');
  });

  it('rewrites styleInject so the module adds no <style> elements', () => {
    const code = transform(bcgovModule, BCGOV_ID);
    expect(code).toBeDefined();
    expect(code).not.toContain("createElement('style')");
    expect(code).toContain('adoptedStyleSheets');
    // The CSS and its injection calls are untouched.
    expect(code).toContain('styleInject(css_248z$1);');
    expect(code).toContain('styleInject(css_248z);');
  });

  it('adopts each stylesheet once, in module order, after any already adopted', () => {
    const document = runInFakeDocument(transform(bcgovModule, BCGOV_ID)!);
    expect(document.adoptedStyleSheets.map((sheet) => sheet.cssText)).toEqual([
      '.a { color: red; }',
      '.b { color: blue; }',
    ]);
  });

  it('leaves other modules alone', () => {
    expect(transform(bcgovModule, '/repo/node_modules/some-lib/dist/index.js')).toBeUndefined();
    expect(transform('export const x = 1;', '/repo/apps/portal-web/src/main.tsx')).toBeUndefined();
  });

  it('fails the build when the bcgov module no longer has the expected styleInject', () => {
    expect(() => transform('export const nothing = 1;', BCGOV_ID)).toThrow(/styleInject/);
    const changed = bcgovModule.replace('function styleInject(css, ref) {', 'function styleInject(css, options) {');
    expect(() => transform(changed, BCGOV_ID)).toThrow(/styleInject/);
  });

  it('is included by defineReactAppConfig', () => {
    expect(pluginNames(defineReactAppConfig().plugins)).toContain('sdg:adopted-style-sheets');
  });
});
