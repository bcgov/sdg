// @vitest-environment node
// Node, not jsdom: jsdom's WebCrypto support is not guaranteed, and the signer needs node:crypto.
import { generateKeyPairSync, sign as nodeSign, type KeyObject } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeBase64Url, encodeBase64Url, type ManifestEnvelope } from './envelope.ts';
import type { ManifestPayload } from './manifest.ts';
import { signManifest } from './sign.ts';
import { verifyManifest, type TrustedKeys, type VerifyOptions } from './verify.ts';

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
const backup = testKey('test-backup');
const untrusted = testKey('untrusted');
const keys: TrustedKeys = { [primary.keyId]: primary.publicJwk, [backup.keyId]: backup.publicJwk };

const NOW = Date.UTC(2026, 10, 23);
const DAY = 86_400_000;

function payload(overrides: Partial<ManifestPayload> = {}): ManifestPayload {
  return {
    schema: 1,
    keyset: 'test',
    version: '1.6.0',
    sequence: 1_700_000_000_000,
    floor: 0,
    issuedAt: NOW,
    expires: NOW + 90 * DAY,
    bundle: { path: '/shared-ui/header/v1/bundles/sdg-header-abc123.js', integrity: `sha384-${'A'.repeat(64)}` },
    ...overrides,
  };
}

function options(overrides: Partial<VerifyOptions> = {}): VerifyOptions {
  return { keys, keyset: 'test', now: NOW, floor: 0, ...overrides };
}

/** Signs `bytes` exactly as given, for envelopes the real signer would never produce. */
function rawEnvelope(key: TestKey, signed: Uint8Array, bytes: Uint8Array): ManifestEnvelope {
  const sig = nodeSign('sha256', signed, { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return { keyId: key.keyId, payload: encodeBase64Url(bytes), sig: encodeBase64Url(sig) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verifyManifest', () => {
  it('accepts a manifest signed by the primary key and returns the signed payload', async () => {
    const input = payload();
    const result = await verifyManifest(signManifest(input, primary), options());
    expect(result).toEqual({ ok: true, payload: input });
  });

  it('accepts a manifest signed by the backup key', async () => {
    const result = await verifyManifest(signManifest(payload(), backup), options());
    expect(result).toEqual({ ok: true, payload: payload() });
  });

  it('refuses a manifest with one payload byte flipped', async () => {
    const envelope = signManifest(payload(), primary);
    const bytes = decodeBase64Url(envelope.payload)!;
    bytes[10] = bytes[10]! ^ 0x01;
    const tampered = { ...envelope, payload: encodeBase64Url(bytes) };
    expect(await verifyManifest(tampered, options())).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a keyId that is not in the trusted key list', async () => {
    const result = await verifyManifest(signManifest(payload(), untrusted), options());
    expect(result).toEqual({ ok: false, reason: 'unknown-key' });
  });

  it('refuses a signature over the payload without the domain prefix', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(payload()));
    const result = await verifyManifest(rawEnvelope(primary, bytes, bytes), options());
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a payload for keyset test when verifying as prod', async () => {
    const result = await verifyManifest(signManifest(payload(), primary), options({ keyset: 'prod' }));
    expect(result).toEqual({ ok: false, reason: 'wrong-keyset' });
  });

  it('refuses a manifest that expired one millisecond ago', async () => {
    const result = await verifyManifest(signManifest(payload({ expires: NOW - 1 }), primary), options());
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('accepts an expired manifest when the caller accepts expired signatures (re-signing its own record)', async () => {
    const input = payload({ expires: NOW - 1 });
    const result = await verifyManifest(signManifest(input, primary), options({ acceptExpired: true }));
    expect(result).toEqual({ ok: true, payload: input });
  });

  it('refuses a sequence below the caller floor even when the manifest floor is lower', async () => {
    const result = await verifyManifest(
      signManifest(payload({ sequence: 150, floor: 0 }), primary),
      options({ floor: 200 }),
    );
    expect(result).toEqual({ ok: false, reason: 'below-floor' });
  });

  it('refuses a sequence below the manifest floor', async () => {
    const result = await verifyManifest(signManifest(payload({ sequence: 150, floor: 200 }), primary), options());
    expect(result).toEqual({ ok: false, reason: 'below-floor' });
  });

  it('accepts a sequence equal to the floor', async () => {
    const input = payload({ sequence: 200, floor: 200 });
    const result = await verifyManifest(signManifest(input, primary), options({ floor: 200 }));
    expect(result).toEqual({ ok: true, payload: input });
  });

  it.each([
    ['outside the bundles folder', '/shared-ui/header/v1/sdg-header.js'],
    ['with a .. segment', '/shared-ui/header/v1/bundles/../sdg-header.js'],
    ['with an encoded .. segment', '/shared-ui/header/v1/bundles/%2e%2e/sdg-header.js'],
    ['on another origin', 'https://evil.example/shared-ui/header/v1/bundles/sdg-header-abc123.js'],
    ['protocol-relative to another origin', '//evil.example/shared-ui/header/v1/bundles/sdg-header-abc123.js'],
    ['relative', 'bundles/sdg-header-abc123.js'],
  ])('refuses a bundle path %s', async (_label, path) => {
    const signed = signManifest(payload({ bundle: { ...payload().bundle, path } }), primary);
    expect(await verifyManifest(signed, options())).toEqual({ ok: false, reason: 'bad-bundle-path' });
  });

  it.each([
    ['a non-object', 'manifest'],
    ['a missing signature', { keyId: primary.keyId, payload: 'e30' }],
    ['a payload that is not base64url', { keyId: primary.keyId, payload: 'e30=', sig: 'AA' }],
  ])('refuses %s envelope as malformed', async (_label, envelope) => {
    expect(await verifyManifest(envelope, options())).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a validly signed payload that breaks the schema as malformed', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ ...payload(), sequence: '1' }));
    const signed = new Uint8Array([...new TextEncoder().encode('sdg-header-manifest-v1\n'), ...bytes]);
    const result = await verifyManifest(rawEnvelope(primary, signed, bytes), options());
    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });

  it('returns crypto-unavailable without throwing when crypto.subtle is missing', async () => {
    const envelope = signManifest(payload(), primary);
    vi.stubGlobal('crypto', {});
    await expect(verifyManifest(envelope, options())).resolves.toEqual({ ok: false, reason: 'crypto-unavailable' });
  });
});
