// Generates a keyset's primary and backup ECDSA P-256 key pairs (KTD1, KTD5, R7) for an operator, offline:
//
//   node packages/shared-ui/scripts/generate-keys.ts <keyset> --out <directory outside the repository>
//
// Writes the two public JWKs to keys/<keyset>.json (replacing the keyset's keys) and each private JWK to its own file,
// mode 0600, in the chosen directory, from where the operator moves the primary into its GitHub secret and the backup
// into offline custody (R6). It never prints a private key. Only the local `dev` keyset keeps its private keys in the
// repository (keys/dev.private.json), since only the dev loader trusts them: `generate-keys.ts dev` takes no --out.
// Afterwards run `pnpm --filter @repo/shared-ui build:loaders`: a new key means a new loader (R1).
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { formatJson, isKeysetName, KEYS_DIR, PACKAGE_ROOT, type Jwk, type KeysetFile } from './keysets.ts';

const DEV_KEYSET = 'dev';
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

/** Creates `out` if needed and returns its real path; refuses one inside the repository. */
function refuse(dir: string): never {
  throw new Error(`refusing to write private keys inside the repository (${dir}); choose a directory outside it`);
}

function privateKeyDir(out: string): string {
  const root = repoRoot();
  // Checked before creating it (so a refused path leaves nothing behind) and again once symlinks resolve.
  if (isInside(resolve(out), root)) refuse(resolve(out));
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const dir = realpathSync(out);
  if (isInside(dir, root)) refuse(dir);
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

/** The dev keyset's private keys, committed and labelled (KTD5). */
function writeDevPrivateKeys(keys: GeneratedKey[]): string[] {
  const file = join(KEYS_DIR, `${DEV_KEYSET}.private.json`);
  const record = { warning: DEV_WARNING, keys: Object.fromEntries(keys.map((k) => [k.keyId, k.privateJwk])) };
  writeFileSync(file, formatJson(record));
  return [file];
}

function parse(): { keyset: string; out: string | undefined } {
  const { values, positionals } = parseArgs({ options: { out: { type: 'string' } }, allowPositionals: true });
  const [keyset] = positionals;
  if (positionals.length !== 1 || !keyset || !isKeysetName(keyset)) {
    throw new Error('usage: generate-keys.ts <keyset> --out <directory outside the repository>');
  }
  if (keyset === DEV_KEYSET && values.out !== undefined) throw new Error('the dev keyset takes no --out');
  if (keyset !== DEV_KEYSET && values.out === undefined) throw new Error(`--out is required for keyset "${keyset}"`);
  return { keyset, out: values.out };
}

function main(): void {
  const { keyset, out } = parse();
  const date = utcDate(new Date());
  const keys = [generate(`${keyset}-primary-${date}`), generate(`${keyset}-backup-${date}`)];
  // Check the private-key destination before touching the committed public keys.
  const dir = out === undefined ? undefined : privateKeyDir(out);
  const privateFiles = dir ? writePrivateKeys(dir, keys) : writeDevPrivateKeys(keys);
  const publicFile = join(KEYS_DIR, `${keyset}.json`);
  const keysetFile: KeysetFile = { keyset, keys: Object.fromEntries(keys.map((k) => [k.keyId, k.publicJwk])) };
  writeFileSync(publicFile, formatJson(keysetFile));
  console.info(`Public keys for "${keyset}" written to ${publicFile}:`);
  console.info(formatJson(keysetFile));
  console.info(`Private keys (not shown) written to:\n  ${privateFiles.join('\n  ')}`);
  console.info('Next: pnpm --filter @repo/shared-ui build:loaders, then commit keys/, loaders/ and loaders.lock.json.');
}

process.on('unhandledRejection', (reason) => {
  console.error('generate-keys: unhandled rejection', reason);
  process.exit(1);
});

try {
  main();
} catch (error: unknown) {
  console.error('generate-keys failed', error instanceof Error ? error.message : error);
  process.exit(1);
}
