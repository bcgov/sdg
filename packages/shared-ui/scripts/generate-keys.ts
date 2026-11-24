// Generates a keyset's primary and backup ECDSA P-256 key pairs for an operator, offline:
//
//   node packages/shared-ui/scripts/generate-keys.ts <keyset> --out <directory outside the repository>
//
// Writes the two public JWKs to keys/<keyset>.json (replacing the keyset's keys) and each private JWK to its own file,
// mode 0600, in the chosen directory, from where the operator moves the primary into its GitHub secret and the backup
// into offline custody. It never prints a private key. Only the local `dev` keyset keeps its private keys in the
// repository (keys/dev.private.json), since only the dev loader trusts them: `generate-keys.ts dev` takes no --out.
// Afterwards run `pnpm --filter @repo/shared-ui build:loaders`: a new key means a new loader.
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { DEV_KEYSET, formatJson, isKeysetName, KEYS_DIR, PACKAGE_ROOT, type Jwk, type KeysetFile } from './keysets.ts';

const DEV_WARNING =
  'DEV ONLY. Local development keys, trusted only by loaders/dev/loader.js, which no deployed environment serves. ' +
  'Never use them to sign anything outside a workstation.';

interface GeneratedKey {
  keyId: string;
  publicJwk: Jwk;
  privateJwk: Jwk & { kid: string };
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10).replaceAll('-', '');
}

function jwk(key: KeyObject): Jwk {
  return key.export({ format: 'jwk' });
}

function generate(keyId: string): GeneratedKey {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { keyId, publicJwk: jwk(publicKey), privateJwk: { ...jwk(privateKey), kid: keyId } };
}

/** The repository root (this package is packages/shared-ui). */
function repoRoot(): string {
  return realpathSync(resolve(PACKAGE_ROOT, '../..'));
}

function isInside(dir: string, root: string): boolean {
  const rel = relative(root, dir);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function refuse(dir: string): never {
  throw new Error(`refusing to write private keys inside the repository (${dir}); choose a directory outside it`);
}

export interface GenerateKeysDeps {
  /** Directory where committed public keys live (defaults to `KEYS_DIR`). */
  keysDir?: string;
  /** Repository root that private keys must never be written inside (defaults to the repo root). */
  repoRoot?: string;
  /** Current date for key IDs. */
  now?: () => Date;
  /** Logger for non-secret progress lines. */
  info?: (line: string) => void;
}

/** Creates `out` if needed and returns its real path; refuses one inside `root`. */
export function privateKeyDir(out: string, root = repoRoot()): string {
  const realRoot = realpathSync(root);
  // Checked before creating it (so a refused path leaves nothing behind) and again once symlinks resolve.
  if (isInside(resolve(out), root) || isInside(resolve(out), realRoot)) refuse(resolve(out));
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const dir = realpathSync(out);
  if (isInside(dir, realRoot)) refuse(dir);
  return dir;
}

/** Writes one private JWK per file, mode 0600, never overwriting an existing file. */
function writePrivateKeys(dir: string, keys: GeneratedKey[]): string[] {
  return keys.map(({ keyId, privateJwk }) => {
    const file = join(dir, `${keyId}.private.jwk.json`);
    writeFileSync(file, formatJson(privateJwk), { mode: 0o600, flag: 'wx' });
    return file;
  });
}

/** The dev keyset's private keys, committed and labelled. */
function writeDevPrivateKeys(keysDir: string, keys: GeneratedKey[]): string[] {
  const file = join(keysDir, `${DEV_KEYSET}.private.json`);
  const record = { warning: DEV_WARNING, keys: Object.fromEntries(keys.map((k) => [k.keyId, k.privateJwk])) };
  writeFileSync(file, formatJson(record));
  return [file];
}

function parse(argv: string[]): { keyset: string; out: string | undefined } {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { out: { type: 'string' } },
    allowPositionals: true,
  });
  const [keyset] = positionals;
  if (positionals.length !== 1 || !keyset || !isKeysetName(keyset)) {
    throw new Error('usage: generate-keys.ts <keyset> --out <directory outside the repository>');
  }
  if (keyset === DEV_KEYSET && values.out !== undefined) throw new Error('the dev keyset takes no --out');
  if (keyset !== DEV_KEYSET && values.out === undefined) throw new Error(`--out is required for keyset "${keyset}"`);
  return { keyset, out: values.out };
}

export function runGenerateKeys(
  argv: string[],
  deps: GenerateKeysDeps = {},
): { publicFile: string; privateFiles: string[]; keysetFile: KeysetFile } {
  const { keyset, out } = parse(argv);
  const keysDir = deps.keysDir ?? KEYS_DIR;
  const root = deps.repoRoot ?? repoRoot();
  const info = deps.info ?? console.info;
  const date = utcDate((deps.now ?? (() => new Date()))());
  const keys = [generate(`${keyset}-primary-${date}`), generate(`${keyset}-backup-${date}`)];
  // Check the private-key destination before touching the committed public keys.
  const dir = out === undefined ? undefined : privateKeyDir(out, root);
  const privateFiles = dir ? writePrivateKeys(dir, keys) : writeDevPrivateKeys(keysDir, keys);
  const publicFile = join(keysDir, `${keyset}.json`);
  const keysetFile: KeysetFile = { keyset, keys: Object.fromEntries(keys.map((k) => [k.keyId, k.publicJwk])) };
  writeFileSync(publicFile, formatJson(keysetFile));
  info(`Public keys for "${keyset}" written to ${publicFile}:`);
  info(formatJson(keysetFile));
  info(`Private keys (not shown) written to:\n  ${privateFiles.join('\n  ')}`);
  info('Next: pnpm --filter @repo/shared-ui build:loaders, then commit keys/, loaders/ and loaders.lock.json.');
  return { publicFile, privateFiles, keysetFile };
}

if (import.meta.main) {
  process.on('unhandledRejection', (reason) => {
    console.error('generate-keys: unhandled rejection', reason);
    process.exit(1);
  });

  try {
    runGenerateKeys(process.argv.slice(2));
  } catch (error: unknown) {
    console.error('generate-keys failed', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
