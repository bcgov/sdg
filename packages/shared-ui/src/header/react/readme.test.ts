import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HEADER_ATTRIBUTES, HEADER_EVENTS, HEADER_TAG, headerCdnPath } from '../contract.js';

// A path, not a URL object: jsdom replaces the global URL, which node:fs does not accept.
const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url).href), 'utf8');
const readme = read('../../../README.md');
const preloadCss = read('../preload.css');

// Implementers copy from the README, so it must name exactly what the contract module exports.
describe('README', () => {
  it('documents the tag, the script path, every attribute and every event', () => {
    expect(readme).toContain(`<${HEADER_TAG}`);
    expect(readme).toContain(`/shared-ui/${headerCdnPath()}`);
    for (const name of [...Object.values(HEADER_ATTRIBUTES), ...Object.values(HEADER_EVENTS)]) {
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

  it('carries the pre-load rule exactly as the package ships it', () => {
    const rules = preloadCss.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    expect(readme).toContain(rules);
  });
});
