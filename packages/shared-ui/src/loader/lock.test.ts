// @vitest-environment node
// The committed loaders (KTD5): their bytes never change within a major (R1), so each one must match its sha384 in
// loaders.lock.json and embed exactly its keyset's public keys. Changing a key without `build:loaders` fails here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LOADERS_DIR, LOADERS_LOCK, listKeysets, readKeyset, type LoadersLock } from '../../scripts/keysets.ts';
import { sha384Integrity } from '../../scripts/vite-builds.ts';

const lock: LoadersLock = JSON.parse(readFileSync(LOADERS_LOCK, 'utf8'));
const keysets = listKeysets();
const loaderFile = (keyset: string): string => `${LOADERS_DIR}${keyset}/loader.js`;

// A P-256 coordinate in a JWK is 32 bytes: 43 unpadded base64url characters, quoted in the built script.
const COORDINATE = /["'`]([\w-]{43})["'`]/g;
// The minifier picks the quote; keyset names and keyIds are [a-z0-9-] only (scripts/keysets.ts).
const quoted = (text: string): RegExp => new RegExp(`["'\`]${text}["'\`]`);

describe('committed loaders', () => {
  it('has one locked loader per keyset file, and nothing else', () => {
    expect(keysets).toContain('dev');
    expect(Object.keys(lock).toSorted()).toEqual(keysets);
    expect(readdirSync(LOADERS_DIR).toSorted()).toEqual(keysets);
  });

  it.each(keysets)('%s: the loader matches its sha384 in loaders.lock.json', (keyset) => {
    expect(existsSync(loaderFile(keyset))).toBe(true);
    expect(sha384Integrity(readFileSync(loaderFile(keyset)))).toBe(lock[keyset]?.integrity);
  });

  it.each(keysets)('%s: the loader embeds exactly the keyset name and public keys from keys/', (keyset) => {
    const code = readFileSync(loaderFile(keyset), 'utf8');
    const { keys } = readKeyset(keyset);
    const coordinates = Object.values(keys).flatMap((jwk) => [jwk.x, jwk.y]);
    expect(new Set(Array.from(code.matchAll(COORDINATE), (match) => match[1]))).toEqual(new Set(coordinates));
    for (const keyId of Object.keys(keys)) expect(code).toMatch(quoted(keyId));
    expect(code).toMatch(new RegExp(`keyset:${quoted(keyset).source}`));
  });

  it.each(keysets)('%s: the loader holds no header code (R4)', (keyset) => {
    const code = readFileSync(loaderFile(keyset), 'utf8');
    for (const marker of ['attachShadow', 'customElements.define', 'site-title', 'adoptedStyleSheets']) {
      expect(code).not.toContain(marker);
    }
  });
});
