import { generateKeyPairSync, webcrypto, type KeyObject } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { ManifestEnvelope } from '../signing/envelope.ts';
import type { ManifestPayload } from '../signing/manifest.ts';
import { signManifest } from '../signing/sign.ts';
import type { TrustedKeys } from '../signing/verify.ts';
import { floorKey } from './floor-store.ts';
import { loadHeader, type LoaderOutcome } from './loader.ts';

interface TestKey {
  keyId: string;
  privateKey: KeyObject;
  publicJwk: JsonWebKey;
}

function testKey(keyId: string): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { keyId, privateKey, publicJwk: publicKey.export({ format: 'jwk' }) };
}

const primary = testKey('test-primary');
const untrusted = testKey('test-primary-impostor');
const keys: TrustedKeys = { [primary.keyId]: primary.publicJwk };

const ORIGIN = 'https://portal.example';
const MANIFEST_URL = `${ORIGIN}/shared-ui/header/v1/manifest.json`;
const FLOOR_KEY = floorKey('test', 1);
const NOW = Date.UTC(2026, 10, 23);
const DAY = 86_400_000;
const INTEGRITY_A = `sha384-${'A'.repeat(64)}`;
const INTEGRITY_B = `sha384-${'B'.repeat(64)}`;

function payload(overrides: Partial<ManifestPayload> = {}): ManifestPayload {
  return {
    schema: 1,
    keyset: 'test',
    version: '1.6.0',
    sequence: 300,
    floor: 0,
    issuedAt: NOW,
    expires: NOW + 90 * DAY,
    bundle: { path: '/shared-ui/header/v1/bundles/sdg-header-a.js', integrity: INTEGRITY_A },
    ...overrides,
  };
}

function signed(overrides: Partial<ManifestPayload> = {}, key: TestKey = primary): ManifestEnvelope {
  return signManifest(payload(overrides), key);
}

/** A fetch that answers each call with the next envelope (the last one repeats). */
function manifestFetch(...envelopes: ManifestEnvelope[]) {
  let call = 0;
  return vi.fn<typeof fetch>(async () => {
    const envelope = envelopes[Math.min(call++, envelopes.length - 1)];
    return new Response(JSON.stringify(envelope), { status: 200 });
  });
}

function start(fetchFn: typeof fetch): Promise<LoaderOutcome> {
  return loadHeader(
    { keyset: 'test', keys, major: 1 },
    { document, fetch: fetchFn, storage: () => window.localStorage, now: () => NOW },
  );
}

function insecure(): never {
  throw new DOMException('The operation is insecure.', 'SecurityError');
}

function bundleScripts(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll('script'));
}

/** Waits for bundle script number `index` (0-based) and fires `type` on it. */
async function settleBundle(index: number, type: 'load' | 'error'): Promise<void> {
  await vi.waitFor(() => expect(bundleScripts()).toHaveLength(index + 1));
  bundleScripts()[index]!.dispatchEvent(new Event(type));
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
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadHeader', () => {
  it('fetches the manifest from its own origin and injects the bundle with its integrity', async () => {
    const fetchFn = manifestFetch(signed());
    const outcome = start(fetchFn);
    await settleBundle(0, 'load');

    await expect(outcome).resolves.toBe('loaded');
    expect(fetchFn).toHaveBeenCalledExactlyOnceWith(MANIFEST_URL, { credentials: 'omit', cache: 'no-cache' });
    const [script] = bundleScripts();
    expect(bundleScripts()).toHaveLength(1);
    expect(script!.src).toBe(`${ORIGIN}/shared-ui/header/v1/bundles/sdg-header-a.js`);
    expect(script!.integrity).toBe(INTEGRITY_A);
    expect(script!.crossOrigin).toBe('anonymous');
  });

  it('refuses a manifest signed by an untrusted key (AE2)', async () => {
    const impostor = { ...signed({}, untrusted), keyId: primary.keyId };
    await expect(start(manifestFetch(impostor))).resolves.toBe('no-header');
    await expect(start(manifestFetch(signed({}, untrusted)))).resolves.toBe('no-header');

    expect(bundleScripts()).toHaveLength(0);
    expect(errors).toHaveBeenCalledWith(
      expect.stringMatching(/^shared-ui: /),
      expect.objectContaining({ reason: 'bad-signature' }),
    );
    expect(errors).toHaveBeenCalledWith(
      expect.stringMatching(/^shared-ui: /),
      expect.objectContaining({ reason: 'unknown-key' }),
    );
  });

  it('refuses a release below the remembered floor even when its own floor is 0 (AE3)', async () => {
    window.localStorage.setItem(FLOOR_KEY, '200');
    await expect(start(manifestFetch(signed({ sequence: 150, floor: 0 })))).resolves.toBe('no-header');

    expect(bundleScripts()).toHaveLength(0);
    expect(errors).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ reason: 'below-floor' }));
    expect(window.localStorage.getItem(FLOOR_KEY)).toBe('200');
  });

  it('refuses an expired manifest when no floor is remembered (AE4)', async () => {
    await expect(start(manifestFetch(signed({ expires: NOW - 1 })))).resolves.toBe('no-header');

    expect(bundleScripts()).toHaveLength(0);
    expect(errors).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ reason: 'expired' }));
  });

  it('loads a newly sequenced rollback above the remembered floor (AE5)', async () => {
    window.localStorage.setItem(FLOOR_KEY, '100');
    const outcome = start(manifestFetch(signed({ sequence: 300, floor: 100 })));
    await settleBundle(0, 'load');

    await expect(outcome).resolves.toBe('loaded');
    expect(window.localStorage.getItem(FLOOR_KEY)).toBe('100');
  });

  it('remembers a raised floor and then refuses a replayed older release (AE6)', async () => {
    window.localStorage.setItem(FLOOR_KEY, '100');
    const first = start(manifestFetch(signed({ sequence: 250, floor: 250 })));
    await settleBundle(0, 'load');
    await expect(first).resolves.toBe('loaded');
    expect(window.localStorage.getItem(FLOOR_KEY)).toBe('250');

    await expect(start(manifestFetch(signed({ sequence: 200, floor: 100 })))).resolves.toBe('no-header');
    expect(bundleScripts()).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ reason: 'below-floor' }));
  });

  it('still loads and logs the fallback when storage throws on read and write', async () => {
    const outcome = loadHeader(
      { keyset: 'test', keys, major: 1 },
      { document, fetch: manifestFetch(signed()), storage: insecure, now: () => NOW },
    );
    await settleBundle(0, 'load');

    await expect(outcome).resolves.toBe('loaded');
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/manifest floor alone/), expect.anything());
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/cannot remember/), expect.anything());
  });

  it.each([
    ['rejects', vi.fn<typeof fetch>(async () => Promise.reject(new TypeError('Failed to fetch')))],
    ['answers 404', vi.fn<typeof fetch>(async () => new Response('not found', { status: 404 }))],
  ])('injects nothing and logs when the manifest fetch %s', async (_, fetchFn) => {
    const unhandled = vi.fn<(reason: unknown) => void>();
    process.on('unhandledRejection', unhandled);
    try {
      await expect(start(fetchFn)).resolves.toBe('no-header');
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off('unhandledRejection', unhandled);
    }

    expect(bundleScripts()).toHaveLength(0);
    expect(errors).toHaveBeenCalledWith(
      expect.stringMatching(/^shared-ui: /),
      expect.objectContaining({ url: MANIFEST_URL }),
    );
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('refetches the manifest and retries a failed bundle once, with the new bundle', async () => {
    const next = signed({
      sequence: 400,
      bundle: { path: '/shared-ui/header/v1/bundles/sdg-header-b.js', integrity: INTEGRITY_B },
    });
    const fetchFn = manifestFetch(signed(), next);
    const outcome = start(fetchFn);
    await settleBundle(0, 'error');
    await settleBundle(1, 'load');

    await expect(outcome).resolves.toBe('loaded');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(bundleScripts()[1]!.src).toBe(`${ORIGIN}/shared-ui/header/v1/bundles/sdg-header-b.js`);
    expect(bundleScripts()[1]!.integrity).toBe(INTEGRITY_B);
  });

  it('gives up after one retry when the bundle keeps failing, as on an integrity mismatch (AE1)', async () => {
    const fetchFn = manifestFetch(signed());
    const outcome = start(fetchFn);
    await settleBundle(0, 'error');
    await settleBundle(1, 'error');

    await expect(outcome).resolves.toBe('no-header');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(bundleScripts()).toHaveLength(2);
    expect(bundleScripts()[1]!.src).toBe(bundleScripts()[0]!.src);
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^shared-ui: /), expect.anything());
  });

  it('fetches nothing when sdg-header is already defined', async () => {
    vi.spyOn(window.customElements, 'get').mockImplementation((name) =>
      name === 'sdg-header' ? class extends HTMLElement {} : undefined,
    );
    const fetchFn = manifestFetch(signed());

    await expect(start(fetchFn)).resolves.toBe('already-defined');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(bundleScripts()).toHaveLength(0);
  });
});
