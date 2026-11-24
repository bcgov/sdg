// U2's loader behaviour, checked against a loader freshly built from source the way `build:loaders` builds one
// (no byte comparison): the committed loaders can only drift from the source through a deliberate rebuild.
import { generateKeyPairSync, webcrypto, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInThisContext } from 'node:vm';

import { build } from 'vite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { loaderBuildConfig } from '../../scripts/vite-builds.ts';
import type { ManifestPayload } from '../signing/manifest.ts';
import { signManifest } from '../signing/sign.ts';
import { floorKey } from './floor-store.ts';

const ORIGIN = 'https://portal.example';
const KEYSET = 'test';
const DAY = 86_400_000;
const INTEGRITY = `sha384-${'A'.repeat(64)}`;

function keyPair(keyId: string): { keyId: string; privateKey: KeyObject; publicJwk: JsonWebKey } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { keyId, privateKey, publicJwk: publicKey.export({ format: 'jwk' }) };
}

const primary = keyPair('test-primary');
const backup = keyPair('test-backup');
const untrusted = keyPair('test-primary');

let workDir: string;
let loaderCode: string;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'shared-ui-loader-'));
  const keys = { [primary.keyId]: primary.publicJwk, [backup.keyId]: backup.publicJwk };
  await build({ configFile: false, ...loaderBuildConfig({ keyset: KEYSET, keys, outDir: workDir }) });
  loaderCode = readFileSync(join(workDir, 'loader.js'), 'utf8');
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function payload(overrides: Partial<ManifestPayload> = {}): ManifestPayload {
  const now = Date.now();
  return {
    schema: 1,
    keyset: KEYSET,
    version: '1.6.0',
    sequence: 300,
    floor: 0,
    issuedAt: now,
    expires: now + 90 * DAY,
    bundle: { path: '/shared-ui/header/v1/bundles/sdg-header-a.js', integrity: INTEGRITY },
    ...overrides,
  };
}

let errors: MockInstance<Console['error']>;

beforeEach(() => {
  // jsdom's WebCrypto support is not guaranteed; the loader needs ECDSA verify.
  vi.stubGlobal('crypto', webcrypto);
  document.head.replaceChildren();
  window.localStorage.clear();
  const loaderScript = document.createElement('script');
  loaderScript.src = `${ORIGIN}/shared-ui/header/v1/loader.js`;
  Object.defineProperty(document, 'currentScript', { value: loaderScript, configurable: true });
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Runs the built loader as a classic script on this page, answering its manifest request with `envelope`. */
function runLoader(envelope: unknown, rememberedFloor?: number) {
  if (rememberedFloor !== undefined) window.localStorage.setItem(floorKey(KEYSET, 1), String(rememberedFloor));
  const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(envelope), { status: 200 }));
  vi.stubGlobal('fetch', fetchFn);
  // In the global scope, as a classic <script> runs.
  runInThisContext(loaderCode);
  return { fetchFn };
}

function bundles(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll('script'));
}

describe('a loader built from source', () => {
  it('fetches the manifest from its own origin and injects the verified bundle with its integrity', async () => {
    const { fetchFn } = runLoader(signManifest(payload(), primary));
    await vi.waitFor(() => expect(bundles()).toHaveLength(1));
    expect(fetchFn).toHaveBeenCalledExactlyOnceWith(`${ORIGIN}/shared-ui/header/v1/manifest.json`, {
      credentials: 'omit',
      cache: 'no-cache',
    });
    expect(bundles()[0]!.src).toBe(`${ORIGIN}/shared-ui/header/v1/bundles/sdg-header-a.js`);
    expect(bundles()[0]!.integrity).toBe(INTEGRITY);
    expect(bundles()[0]!.crossOrigin).toBe('anonymous');
  });

  it('accepts a manifest signed with the backup key (R7)', async () => {
    runLoader(signManifest(payload(), backup));
    await vi.waitFor(() => expect(bundles()).toHaveLength(1));
  });

  it.each([
    ['signed by an untrusted key (AE2)', () => signManifest(payload(), untrusted), undefined],
    ['for another keyset', () => signManifest(payload({ keyset: 'prod' }), primary), undefined],
    ['past its expiry (AE4)', () => signManifest(payload({ expires: Date.now() - 1 }), primary), undefined],
    ['below the remembered floor (AE3)', () => signManifest(payload({ sequence: 300 }), primary), 400],
  ])('refuses a manifest %s and injects nothing', async (_name, envelope, floor) => {
    runLoader(envelope(), floor);
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith(
        'shared-ui: header manifest refused; the page shows no header',
        expect.anything(),
      ),
    );
    expect(bundles()).toHaveLength(0);
  });
});
