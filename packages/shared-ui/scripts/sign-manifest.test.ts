// @vitest-environment node
// U4's signing CLI. Test keys are generated here; the real ones never leave their secrets.
import { execFile } from 'node:child_process';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeBase64Url } from '../src/signing/envelope.ts';
import type { ManifestPayload } from '../src/signing/manifest.ts';
import { signManifest } from '../src/signing/sign.ts';
import { verifyManifest } from '../src/signing/verify.ts';
import type { Jwk, PublicKeys } from './keysets.ts';
import { runSignManifest, type SignDeps } from './sign-manifest.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 23, 3);
const SEQUENCE = 1_795_000_000_000;
const BUNDLE = {
  path: '/shared-ui/header/v1/bundles/sdg-header-BeJDFGwY.js',
  integrity: `sha384-${'A'.repeat(64)}`,
};

interface TestKey {
  keyId: string;
  privateKey: KeyObject;
  privateJwk: Jwk;
  publicJwk: Jwk;
}

function testKey(keyId: string): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    keyId,
    privateKey,
    privateJwk: privateKey.export({ format: 'jwk' }),
    publicJwk: publicKey.export({ format: 'jwk' }),
  };
}

const primary = testKey('test-primary');
const backup = testKey('test-backup');
const prPrimary = testKey('pr-primary');
const KEYSETS: Record<string, PublicKeys> = {
  test: { [primary.keyId]: primary.publicJwk, [backup.keyId]: backup.publicJwk },
  pr: { [prPrimary.keyId]: prPrimary.publicJwk },
};

let dir: string;
let out: string;
let fetchLive: ReturnType<typeof vi.fn<SignDeps['fetch']>>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sign-manifest-'));
  out = join(dir, 'manifest.json');
  fetchLive = vi.fn<SignDeps['fetch']>();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    HEADER_SIGNING_KEY: JSON.stringify(primary.privateJwk),
    HEADER_SIGNING_KEY_ID: primary.keyId,
    HEADER_KEYSET: 'test',
    HEADER_FLOOR: '0',
    ...overrides,
  };
}

const deps = (now = NOW): SignDeps => ({
  now: () => now,
  fetch: fetchLive,
  readKeys: (keyset) => KEYSETS[keyset] ?? {},
});

function writeJson(name: string, value: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(value));
  return file;
}

function releaseJson(sequence = SEQUENCE): string {
  return writeJson('release.json', { schema: 1, sequence, bundle: BUNDLE });
}

function written(): ManifestPayload {
  const envelope = JSON.parse(readFileSync(out, 'utf8'));
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(envelope.payload)));
}

function record(overrides: Partial<ManifestPayload> = {}, key: TestKey = primary): string {
  const payload: ManifestPayload = {
    schema: 1,
    keyset: 'test',
    version: '1.5.0',
    sequence: SEQUENCE,
    floor: 0,
    issuedAt: NOW - 10 * DAY,
    expires: NOW + 80 * DAY,
    bundle: BUNDLE,
    ...overrides,
  };
  return writeJson('record.json', signManifest(payload, key));
}

const release = (file: string, version = '1.6.0'): string[] => [
  'release',
  '--release',
  file,
  '--version',
  version,
  '--out',
  out,
];
const resign = (file: string, ...extra: string[]): string[] => ['resign', '--record', file, '--out', out, ...extra];

describe('release mode', () => {
  it('writes an envelope that verifies, with the build sequence, a 90-day expiry and the input floor', async () => {
    await runSignManifest(release(releaseJson()), env({ HEADER_FLOOR: '1700000000000' }), deps());

    const result = await verifyManifest(JSON.parse(readFileSync(out, 'utf8')), {
      keys: KEYSETS['test']!,
      keyset: 'test',
      now: NOW,
      floor: 0,
    });
    expect(result).toEqual({
      ok: true,
      payload: {
        schema: 1,
        keyset: 'test',
        version: '1.6.0',
        sequence: SEQUENCE,
        floor: 1_700_000_000_000,
        issuedAt: NOW,
        expires: NOW + 90 * DAY,
        bundle: BUNDLE,
      },
    });
  });

  it('refuses a release.json whose sequence is below the floor, naming both values, and writes nothing', async () => {
    const floor = SEQUENCE + 1;
    await expect(runSignManifest(release(releaseJson()), env({ HEADER_FLOOR: String(floor) }), deps())).rejects.toThrow(
      `floor ${floor} is above sequence ${SEQUENCE}`,
    );
    expect(existsSync(out)).toBe(false);
  });
});

describe('resign mode', () => {
  it('keeps sequence, version and bundle, and moves expiry and floor forward', async () => {
    await runSignManifest(resign(record({ floor: 5 })), env({ HEADER_FLOOR: '7' }), deps());
    expect(written()).toEqual({
      schema: 1,
      keyset: 'test',
      version: '1.5.0',
      sequence: SEQUENCE,
      floor: 7,
      issuedAt: NOW,
      expires: NOW + 90 * DAY,
      bundle: BUNDLE,
    });
  });

  it('accepts an expired but validly signed record and re-signs it with a fresh expiry', async () => {
    const file = record({ issuedAt: NOW - 100 * DAY, expires: NOW - 10 * DAY });
    await runSignManifest(resign(file), env(), deps());
    expect(written()).toMatchObject({ issuedAt: NOW, expires: NOW + 90 * DAY, sequence: SEQUENCE });
  });

  it('refuses a record whose signature fails, and writes nothing', async () => {
    const file = record();
    const envelope = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...envelope, keyId: backup.keyId }));
    await expect(runSignManifest(resign(file), env(), deps())).rejects.toThrow('bad-signature');
    expect(existsSync(out)).toBe(false);
  });

  it.each([
    ['signed with another keyset key', () => record({ keyset: 'pr' }, prPrimary), 'unknown-key'],
    ['naming another keyset', () => record({ keyset: 'pr' }), 'wrong-keyset'],
  ])('refuses a record %s', async (_label, file, reason) => {
    await expect(runSignManifest(resign(file()), env(), deps())).rejects.toThrow(reason);
    expect(existsSync(out)).toBe(false);
  });

  it('re-signs when the live manifest carries the record sequence', async () => {
    const file = record();
    fetchLive.mockResolvedValue(Response.json(JSON.parse(readFileSync(file, 'utf8'))));
    await runSignManifest(resign(file, '--live-url', 'https://portal.example/m.json'), env(), deps());
    expect(fetchLive).toHaveBeenCalledWith('https://portal.example/m.json', expect.anything());
    expect(written().sequence).toBe(SEQUENCE);
  });

  it('fails when the live manifest sequence differs from the record, and writes nothing', async () => {
    const older = signManifest(
      {
        schema: 1,
        keyset: 'test',
        version: '1.4.0',
        sequence: SEQUENCE - 1000,
        floor: 0,
        issuedAt: NOW - DAY,
        expires: NOW + 89 * DAY,
        bundle: BUNDLE,
      },
      primary,
    );
    fetchLive.mockResolvedValue(Response.json(older));
    const run = runSignManifest(resign(record(), '--live-url', 'https://portal.example/m.json'), env(), deps());
    await expect(run).rejects.toThrow(
      `live manifest sequence ${SEQUENCE - 1000} differs from the record's ${SEQUENCE}`,
    );
    expect(existsSync(out)).toBe(false);
  });
});

describe('either mode', () => {
  it.each([
    ['release', () => release(releaseJson())],
    ['resign', () => resign(record())],
  ])('%s exits non-zero when the floor is above the sequence, naming both values', async (_mode, argv) => {
    const run = runSignManifest(argv(), env({ HEADER_FLOOR: String(SEQUENCE + 5) }), deps());
    await expect(run).rejects.toThrow(`floor ${SEQUENCE + 5} is above sequence ${SEQUENCE}`);
    expect(existsSync(out)).toBe(false);
  });

  it('a missing private key exits non-zero without echoing any environment value', async () => {
    const script = join(import.meta.dirname, 'sign-manifest.ts');
    const secretLooking = 'SENTINEL-key-id-value';
    const childEnv = {
      PATH: process.env['PATH'],
      HEADER_SIGNING_KEY_ID: secretLooking,
      HEADER_KEYSET: 'test',
      HEADER_FLOOR: 'SENTINEL-floor',
    };
    const child = promisify(execFile)(process.execPath, [script, ...release(releaseJson())], { env: childEnv });
    const failure = await child.then(
      () => undefined,
      (error: { code?: number; stdout: string; stderr: string }) => error,
    );
    expect(failure?.code).toBe(1);
    expect(failure?.stderr).toContain('HEADER_SIGNING_KEY is not set');
    expect(`${failure?.stdout}${failure?.stderr}`).not.toContain('SENTINEL');
    expect(existsSync(out)).toBe(false);
  });
});
