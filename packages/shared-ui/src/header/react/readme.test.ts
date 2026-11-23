import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HEADER_ATTRIBUTES, HEADER_EVENTS, HEADER_PATHS, HEADER_TAG, RETURN_TO_PARAM } from '../contract.js';

// A path, not a URL object: jsdom replaces the global URL, which node:fs does not accept.
const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url).href), 'utf8');
const readme = read('../../../README.md');
const preloadCss = read('../preload.css');
const lock: Record<string, { integrity: string } | undefined> = JSON.parse(read('../../../loaders.lock.json'));

/** The keysets implementers embed, by README table row (`dev` is local only and not documented for embedding). */
const DEPLOYED_KEYSETS = ['prod', 'test', 'pr'] as const;

/** The marked stand-in the README may show only for a keyset whose loader is not yet in loaders.lock.json. */
const placeholder = (keyset: string): string => `sha384-PLACEHOLDER-${keyset}-loader-not-generated-yet`;

// Implementers copy from the README, so it must name exactly what the contract module exports.
describe('README', () => {
  it('documents the tag, the loader path, every attribute, every event and the return-to parameter', () => {
    expect(readme).toContain(`<${HEADER_TAG}`);
    expect(readme).toContain(`/shared-ui/${HEADER_PATHS.loader}`);
    for (const name of [...Object.values(HEADER_ATTRIBUTES), ...Object.values(HEADER_EVENTS), RETURN_TO_PARAM]) {
      expect(readme).toContain(`\`${name}\``);
    }
  });

  it('names no attribute or event the contract does not export', () => {
    const documented = new Set(
      [...readme.matchAll(/`((?:site|user|login|logout|settings)-[a-z]+|sdg-[a-z]+)`/g)].map((m) => m[1]),
    );
    const exported = new Set<string>([
      HEADER_TAG,
      ...Object.values(HEADER_ATTRIBUTES),
      ...Object.values(HEADER_EVENTS),
    ]);
    expect([...documented].filter((name) => name !== undefined && !exported.has(name))).toEqual([]);
  });

  it.each(DEPLOYED_KEYSETS)(
    "gives the %s loader's integrity from loaders.lock.json, or the marked placeholder while it has none",
    (keyset) => {
      expect(readme).toContain(lock[keyset]?.integrity ?? placeholder(keyset));
      expect(readme.includes(placeholder(keyset))).toBe(lock[keyset] === undefined);
    },
  );

  it('shows no integrity value that is neither a locked loader nor an allowed placeholder', () => {
    const allowed = new Set(DEPLOYED_KEYSETS.map((keyset) => lock[keyset]?.integrity ?? placeholder(keyset)));
    const shown = [...readme.matchAll(/sha384-[A-Za-z0-9+/=-]+/g)].map((m) => m[0]);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.filter((value) => !allowed.has(value))).toEqual([]);
  });

  it('carries the pre-load rule exactly as the package ships it', () => {
    const rules = preloadCss.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    expect(readme).toContain(rules);
  });
});
