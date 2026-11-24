// Signs or verifies the header manifest, for every workflow that publishes or checks one:
//
//   sign-manifest.ts release --release <release.json> --version <label> --out <manifest.json>
//   sign-manifest.ts resign --record <previous manifest.json> [--live-url <manifest URL>] --out <manifest.json>
//   sign-manifest.ts verify --keyset <keyset> --manifest <manifest.json> [--accept-expired]
//
// `release` signs a new build: sequence and bundle come from the build's `release.json`. `resign` re-signs CI's own
// record of the current release (the previous signing run's envelope): it verifies the record against
// keys/<keyset>.json, accepting an expired signature, keeps its sequence, version and bundle, and moves only the
// expiry and floor. Given the live manifest URL it only compares: a live sequence other than the record's fails, so
// content read back from the edge is never signed. Both refuse a floor above the sequence. `verify` checks an envelope
// against keys/<keyset>.json and prints the verified payload as JSON.
//
// Environment (release/resign): HEADER_SIGNING_KEY (a P-256 private JWK as JSON), HEADER_SIGNING_KEY_ID, HEADER_KEYSET,
// HEADER_FLOOR (a sequence, ms) and HEADER_TTL_DAYS (default 90). It prints only non-secret fields and never an env value.
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import type { ManifestEnvelope } from '../src/signing/envelope.ts';
import { MANIFEST_SCHEMA, isCount, isRecord, type ManifestPayload } from '../src/signing/manifest.ts';
import { signManifest, type SigningKey } from '../src/signing/sign.ts';
import { verifyManifest, type VerifyResult } from '../src/signing/verify.ts';
import { DAY_MS, DEFAULT_TTL_DAYS, formatJson, isKeysetName, readKeyset, type PublicKeys } from './keysets.ts';

const LIVE_FETCH_TIMEOUT_MS = 15_000;

export interface SignDeps {
  /** Signing time, ms since the epoch. */
  now: () => number;
  /** Fetches the live manifest, for `resign --live-url` only. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The keyset's trusted public keys (keys/<keyset>.json). */
  readKeys: (keyset: string) => PublicKeys;
}

interface Settings {
  key: SigningKey;
  keyset: string;
  floor: number;
  ttlDays: number;
}

/** What a run prints: the signed payload's fields and where it went. Nothing secret. */
export interface SignSummary {
  mode: 'release' | 'resign';
  keyId: string;
  out: string;
  payload: ManifestPayload;
}

/** Thrown for every refusal; its message never contains an environment value. */
class SignError extends Error {}

/** A non-negative integer from env `name`; the message names the variable, never its value. */
function envInteger(env: NodeJS.ProcessEnv, name: string, fallback?: number): number {
  const text = env[name];
  if (text === undefined || text === '') {
    if (fallback !== undefined) return fallback;
    throw new SignError(`${name} is not set`);
  }
  const value = Number(text);
  if (!/^\d+$/.test(text) || !isCount(value)) throw new SignError(`${name} must be a non-negative integer`);
  return value;
}

function privateKey(env: NodeJS.ProcessEnv): KeyObject {
  const text = env['HEADER_SIGNING_KEY'];
  if (text === undefined || text === '') throw new SignError('HEADER_SIGNING_KEY is not set');
  let key: KeyObject;
  try {
    // JSON.parse and createPrivateKey errors can quote the input, so neither message is passed on.
    key = createPrivateKey({ key: JSON.parse(text), format: 'jwk' });
  } catch {
    throw new SignError('HEADER_SIGNING_KEY is not a private JWK');
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new SignError('HEADER_SIGNING_KEY is not a P-256 key');
  }
  return key;
}

function readSettings(env: NodeJS.ProcessEnv): Settings {
  const key = privateKey(env);
  const keyId = env['HEADER_SIGNING_KEY_ID'];
  if (!keyId) throw new SignError('HEADER_SIGNING_KEY_ID is not set');
  const keyset = env['HEADER_KEYSET'] ?? '';
  if (!isKeysetName(keyset)) throw new SignError('HEADER_KEYSET is not set to a keyset name');
  const floor = envInteger(env, 'HEADER_FLOOR');
  const ttlDays = envInteger(env, 'HEADER_TTL_DAYS', DEFAULT_TTL_DAYS);
  if (ttlDays === 0) throw new SignError('HEADER_TTL_DAYS must be at least 1');
  return { key: { keyId, privateKey: key }, keyset, floor, ttlDays };
}

function readJson(file: string, what: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error: unknown) {
    throw new SignError(`cannot read ${what} ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type Unsigned = Pick<ManifestPayload, 'version' | 'sequence' | 'bundle'>;

/** The release to sign from a build's `release.json` and its version label. */
function fromReleaseJson(file: string, version: string): Unsigned {
  const value = readJson(file, 'release.json');
  const record = isRecord(value) ? value : {};
  const { schema, sequence, bundle } = record;
  const { path, integrity } = isRecord(bundle) ? bundle : {};
  // The path and integrity formats are checked when the signed result is verified (`sign`).
  if (schema !== 1 || !isCount(sequence) || typeof path !== 'string' || typeof integrity !== 'string') {
    throw new SignError(`${file} is not a release.json ({ schema: 1, sequence, bundle: { path, integrity } })`);
  }
  return { version, sequence, bundle: { path, integrity } };
}

/** Verifies `envelope` against the keyset's public keys; an expired signature is fine. */
function verifyAcceptingExpired(envelope: unknown, settings: Settings, deps: SignDeps): Promise<VerifyResult> {
  const { keyset } = settings;
  return verifyManifest(envelope, {
    keys: deps.readKeys(keyset),
    keyset,
    now: deps.now(),
    floor: 0,
    acceptExpired: true,
  });
}

/** The release in CI's signed record, after verifying it. */
async function fromRecord(file: string, settings: Settings, deps: SignDeps): Promise<Unsigned> {
  const result = await verifyAcceptingExpired(readJson(file, 'record'), settings, deps);
  if (!result.ok) throw new SignError(`refusing to re-sign ${file}: the record does not verify (${result.reason})`);
  const { version, sequence, bundle } = result.payload;
  return { version, sequence, bundle };
}

/** The live manifest's sequence, after verifying it; it is only compared, never signed. */
async function liveSequence(url: string, settings: Settings, deps: SignDeps): Promise<number> {
  const response = await deps.fetch(url, { signal: AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS), cache: 'no-store' });
  if (!response.ok) throw new SignError(`live manifest ${url} answered ${response.status}`);
  const result = await verifyAcceptingExpired(await response.json(), settings, deps);
  if (!result.ok) throw new SignError(`live manifest ${url} does not verify (${result.reason})`);
  return result.payload.sequence;
}

async function resignInput(
  record: string,
  liveUrl: string | undefined,
  settings: Settings,
  deps: SignDeps,
): Promise<Unsigned> {
  const [unsigned, live] = await Promise.all([
    fromRecord(record, settings, deps),
    liveUrl === undefined ? undefined : liveSequence(liveUrl, settings, deps),
  ]);
  if (live !== undefined && live !== unsigned.sequence) {
    throw new SignError(
      `live manifest sequence ${live} differs from the record's ${unsigned.sequence}; not re-signing. ` +
        'Find out why the live release is not the last one CI signed before re-signing anything.',
    );
  }
  return unsigned;
}

/** Signs `unsigned` with a fresh expiry and the input floor, and checks the result as the loader would. */
async function sign(
  unsigned: Unsigned,
  settings: Settings,
  deps: SignDeps,
): Promise<{ envelope: ManifestEnvelope; payload: ManifestPayload }> {
  const { floor, keyset } = settings;
  if (floor > unsigned.sequence) {
    throw new SignError(
      `floor ${floor} is above sequence ${unsigned.sequence} (version ${unsigned.version}); refusing to sign ` +
        'a release that every loader would refuse',
    );
  }
  const issuedAt = deps.now();
  const expires = issuedAt + settings.ttlDays * DAY_MS;
  const payload: ManifestPayload = { schema: MANIFEST_SCHEMA, keyset, ...unsigned, floor, issuedAt, expires };
  const envelope = signManifest(payload, settings.key);
  // A key the keyset doesn't trust, or a bundle path the loader refuses, would take the header down once deployed.
  const check = await verifyManifest(envelope, { keys: deps.readKeys(keyset), keyset, now: issuedAt, floor: 0 });
  if (!check.ok) throw new SignError(`the signed manifest would not load (${check.reason}); nothing written`);
  return { envelope, payload };
}

const USAGE =
  'usage: sign-manifest.ts release --release <release.json> --version <label> --out <file>\n' +
  '       sign-manifest.ts resign --record <manifest.json> [--live-url <url>] --out <file>\n' +
  '       sign-manifest.ts verify --keyset <keyset> --manifest <manifest.json> [--accept-expired]';

function parse(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      release: { type: 'string' },
      version: { type: 'string' },
      record: { type: 'string' },
      'live-url': { type: 'string' },
      out: { type: 'string' },
      keyset: { type: 'string' },
      manifest: { type: 'string' },
      'accept-expired': { type: 'boolean' },
    },
  });
  const [mode] = positionals;
  const { release, version, record, out, keyset, manifest } = values;
  const acceptExpired = values['accept-expired'] === true;
  if (positionals.length !== 1) throw new SignError(USAGE);
  if (mode === 'verify' && keyset && manifest && !out && !release && !version && !record && !values['live-url']) {
    if (!isKeysetName(keyset)) throw new SignError(`invalid keyset "${keyset}"`);
    return { mode, keyset, manifest, acceptExpired } as const;
  }
  if (!out || keyset || manifest || acceptExpired) throw new SignError(USAGE);
  if (mode === 'release' && release && version && !record && !values['live-url']) {
    return { mode, release, version, out } as const;
  }
  if (mode === 'resign' && record && !release && !version) {
    return { mode, record, liveUrl: values['live-url'], out } as const;
  }
  throw new SignError(USAGE);
}

/** Verifies a manifest file against a keyset's public keys; returns the verified payload or throws SignError. */
export async function runVerifyManifest(
  keyset: string,
  manifestFile: string,
  deps: Pick<SignDeps, 'now' | 'readKeys'>,
  acceptExpired = false,
): Promise<ManifestPayload> {
  const value = readJson(manifestFile, 'manifest');
  const result = await verifyManifest(value, {
    keys: deps.readKeys(keyset),
    keyset,
    now: deps.now(),
    floor: 0,
    acceptExpired,
  });
  if (!result.ok) throw new SignError(`${manifestFile} does not verify with keyset ${keyset}: ${result.reason}`);
  return result.payload;
}

/** Runs one signing; throws (and writes nothing) on any refusal. */
export async function runSignManifest(argv: string[], env: NodeJS.ProcessEnv, deps: SignDeps): Promise<SignSummary> {
  const args = parse(argv);
  if (args.mode === 'verify') throw new SignError('use runVerifyManifest for verify mode');
  const settings = readSettings(env);
  const unsigned =
    args.mode === 'release'
      ? fromReleaseJson(args.release, args.version)
      : await resignInput(args.record, args.liveUrl, settings, deps);
  const { envelope, payload } = await sign(unsigned, settings, deps);
  writeFileSync(args.out, formatJson(envelope));
  return { mode: args.mode, keyId: settings.key.keyId, out: args.out, payload };
}

const iso = (ms: number): string => new Date(ms).toISOString();

function printSummary({ mode, keyId, out, payload }: SignSummary): void {
  console.info(
    [
      `sign-manifest ${mode}: wrote ${out}`,
      `  keyset ${payload.keyset}, keyId ${keyId}`,
      `  version ${payload.version}, sequence ${payload.sequence}, floor ${payload.floor}`,
      `  issued ${iso(payload.issuedAt)}, expires ${iso(payload.expires)}`,
      `  bundle ${payload.bundle.path} ${payload.bundle.integrity}`,
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const deps: SignDeps = {
    now: () => Date.now(),
    fetch: (url, init) => fetch(url, init),
    readKeys: (keyset) => readKeyset(keyset).keys,
  };
  const argv = process.argv.slice(2);
  const args = parse(argv);
  if (args.mode === 'verify') {
    const payload = await runVerifyManifest(args.keyset, args.manifest, deps, args.acceptExpired);
    console.log(JSON.stringify(payload));
    return;
  }
  printSummary(await runSignManifest(argv, process.env, deps));
}

if (import.meta.main) {
  process.on('unhandledRejection', (reason) => {
    console.error('sign-manifest: unhandled rejection', reason instanceof Error ? reason.message : reason);
    process.exit(1);
  });
  try {
    await main();
  } catch (error: unknown) {
    // A SignError's message is safe to print; anything else is reported by message only, never with env context.
    console.error(`sign-manifest failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
