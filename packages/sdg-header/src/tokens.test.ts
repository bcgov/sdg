import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { accountMenuStyles } from './account-menu.js';
import { navPanelStyles } from './nav-panel.js';
import { controlStyles, shellStyles } from './styles.js';

const require = createRequire(import.meta.url);
const tokensCss = readFileSync(require.resolve('@bcgov/design-tokens/css/variables.css'), 'utf8');

const normalize = (value: string): string => value.trim().replaceAll(/\s+/gu, ' ').toLowerCase();

/** `--name: value;` declarations in the installed @bcgov/design-tokens. */
const tokens = new Map(
  Array.from(tokensCss.matchAll(/(--[\w-]+):\s*([^;]+);/gu), ([, name = '', value = '']) => [name, normalize(value)]),
);

/** Every `var(--token, fallback)` in the element's CSS. */
const usages = [shellStyles, controlStyles, accountMenuStyles, navPanelStyles].flatMap(({ cssText }) =>
  Array.from(cssText.matchAll(/var\((--[\w-]+)(?:,\s*([^()]+?))?\)/gu), ([, name = '', fallback]) => ({
    name,
    fallback: fallback === undefined ? undefined : normalize(fallback),
  })),
);

describe('design token fallbacks', () => {
  it('parses the installed tokens and the element CSS', () => {
    expect(tokens.size).toBeGreaterThan(100);
    expect(usages.length).toBeGreaterThan(50);
  });

  it('gives every token a fallback, so the header renders without the token stylesheet', () => {
    expect(usages.filter(({ fallback }) => fallback === undefined).map(({ name }) => name)).toEqual([]);
  });

  it('only uses tokens that exist in @bcgov/design-tokens', () => {
    expect(usages.filter(({ name }) => !tokens.has(name)).map(({ name }) => name)).toEqual([]);
  });

  it('uses each token value as its fallback (a token bump that changes a value fails here)', () => {
    const stale = usages
      .filter(({ name, fallback }) => fallback !== tokens.get(name))
      .map(
        ({ name, fallback }) => `${name}: fallback ${fallback ?? '(none)'}, token ${tokens.get(name) ?? '(missing)'}`,
      );
    expect([...new Set(stale)]).toEqual([]);
  });
});
