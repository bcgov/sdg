// The committed public keysets: `keys/<keyset>.json` holds a keyset's primary and backup P-256 public keys,
// which `build:loaders` bakes into `loaders/<keyset>/loader.js`. Private keys never live here, apart from the labelled
// `keys/dev.private.json`. Node-only; shared by the scripts, the Vite build and the lock test.
import type { webcrypto } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isRecord } from '../src/signing/manifest.ts';
import type { PublicJwk } from '../src/signing/verify.ts';

// From the file path string, not `new URL(…)`: under jsdom tests the global URL is jsdom's, which fileURLToPath refuses.
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const KEYS_DIR = join(PACKAGE_ROOT, 'keys/');
export const LOADERS_DIR = join(PACKAGE_ROOT, 'loaders/');
export const LOADERS_LOCK = join(PACKAGE_ROOT, 'loaders.lock.json');

/** The local-only keyset, whose private keys are committed (keys/dev.private.json). */
export const DEV_KEYSET = 'dev';
export const DAY_MS = 86_400_000;
/** How long a signed manifest stays valid unless HEADER_TTL_DAYS says otherwise. */
export const DEFAULT_TTL_DAYS = 90;

/** Public P-256 JWKs keyed by `keyId`: the loader's `TrustedKeys` (src/signing/verify.ts). */
export type PublicKeys = Readonly<Record<string, PublicJwk>>;

export type Jwk = webcrypto.JsonWebKey;

/** The committed form of `keys/<keyset>.json`. */
export interface KeysetFile {
  keyset: string;
  /** Public JWKs (`kty`, `crv`, `x`, `y`) keyed by `keyId`: the primary and the backup. */
  keys: PublicKeys;
}

/** `loaders.lock.json`: each committed loader's Subresource Integrity value, by keyset. */
export type LoadersLock = Record<string, { integrity: string }>;

const KEYSET_NAME = /^[a-z][a-z0-9-]*$/;
const KEYSET_FILE = /^([a-z][a-z0-9-]*)\.json$/;

export function isKeysetName(name: string): boolean {
  return KEYSET_NAME.test(name);
}

/** The keysets with a committed public key file, sorted (`*.private.json` is not a keyset file). */
export function listKeysets(): string[] {
  return readdirSync(KEYS_DIR)
    .map((file) => KEYSET_FILE.exec(file)?.[1])
    .filter((name): name is string => name !== undefined)
    .toSorted((a, b) => a.localeCompare(b));
}

function isPublicP256(jwk: unknown): jwk is Jwk {
  if (!isRecord(jwk)) return false;
  const { kty, crv, x, y, d } = jwk;
  return kty === 'EC' && crv === 'P-256' && typeof x === 'string' && typeof y === 'string' && d === undefined;
}

/** Reads and checks `keys/<keyset>.json`: two or more public P-256 keys, no private part. Throws when malformed. */
export function readKeyset(keyset: string): KeysetFile {
  const file = `${KEYS_DIR}${keyset}.json`;
  const parsed: Partial<KeysetFile> = JSON.parse(readFileSync(file, 'utf8'));
  const keys = parsed.keys ?? {};
  const valid = parsed.keyset === keyset && Object.keys(keys).length >= 2 && Object.values(keys).every(isPublicP256);
  if (!valid) throw new Error(`${file} must name keyset "${keyset}" and hold at least two public P-256 JWKs`);
  return { keyset, keys };
}

/** JSON as the repo formats it (oxfmt-stable), with a trailing newline. */
export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
