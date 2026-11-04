import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppConfigModule } from '../config/config.module.js';
import { TEST_ENV } from '../testing/app.js';
import { CryptoModule } from './crypto.module.js';
import { SecretCipher, SecretDecryptionError } from './secret-cipher.js';

const KEY = 'first-encryption-key-of-at-least-32-chars';
const OTHER_KEY = 'second-encryption-key-of-at-least-32-chars';
const LOCATION = { rowId: '7d1e1c52-5c5e-4f7a-9d55-0f6a2b8f1e10', field: 'config.password' };
const SECRET = 'smtp-p@ssw0rd';

describe('SecretCipher', () => {
  it('returns the original value when decrypted at the same row id and field path', () => {
    const cipher = new SecretCipher(KEY);
    const sealed = cipher.encrypt(SECRET, LOCATION);

    expect(sealed).not.toContain(SECRET);
    expect(new SecretCipher(KEY).decrypt(sealed, LOCATION)).toBe(SECRET);
  });

  it('seals the same value differently each time (random IV)', () => {
    const cipher = new SecretCipher(KEY);
    expect(cipher.encrypt(SECRET, LOCATION)).not.toBe(cipher.encrypt(SECRET, LOCATION));
  });

  it('stores the key id in the sealed value', () => {
    const cipher = new SecretCipher(KEY);
    const [format, keyId] = cipher.encrypt(SECRET, LOCATION).split('.');

    expect(format).toBe('v1');
    expect(keyId).toBe(cipher.keyId);
    expect(new SecretCipher(OTHER_KEY).keyId).not.toBe(cipher.keyId);
  });

  it('fails to decrypt at another row id or field path (AAD binding)', () => {
    const cipher = new SecretCipher(KEY);
    const sealed = cipher.encrypt(SECRET, LOCATION);

    expect(() => cipher.decrypt(sealed, { ...LOCATION, rowId: 'another-row' })).toThrow(SecretDecryptionError);
    expect(() => cipher.decrypt(sealed, { ...LOCATION, field: 'config.user' })).toThrow(SecretDecryptionError);
    // The row id and field path are bound as separate parts, so moving a dot between them does not match.
    const split = cipher.encrypt(SECRET, { rowId: 'a.b', field: 'c' });
    expect(() => cipher.decrypt(split, { rowId: 'a', field: 'b.c' })).toThrow(SecretDecryptionError);
  });

  it('fails when the ciphertext was tampered with', () => {
    const cipher = new SecretCipher(KEY);
    const parts = cipher.encrypt(SECRET, LOCATION).split('.');
    const ciphertext = Buffer.from(parts[4] ?? '', 'base64url');
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    parts[4] = ciphertext.toString('base64url');

    expect(() => cipher.decrypt(parts.join('.'), LOCATION)).toThrow(SecretDecryptionError);
  });

  it('fails with a clear error naming both key ids when the stored key id is unknown', () => {
    const sealer = new SecretCipher(OTHER_KEY);
    const sealed = sealer.encrypt(SECRET, LOCATION);
    const cipher = new SecretCipher(KEY);

    expect(() => cipher.decrypt(sealed, LOCATION)).toThrow(SecretDecryptionError);
    expect(() => cipher.decrypt(sealed, LOCATION)).toThrow(
      `Secret was sealed with key id ${sealer.keyId}, but the configured key id is ${cipher.keyId}`,
    );
  });

  it('rejects a malformed value', () => {
    const cipher = new SecretCipher(KEY);
    expect(() => cipher.decrypt('not-a-sealed-value', LOCATION)).toThrow('Malformed sealed secret');
    expect(() => cipher.decrypt(`v2.${cipher.keyId}.a.b.c`, LOCATION)).toThrow('Malformed sealed secret');
  });
});

describe('CryptoModule', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('provides a SecretCipher keyed by NOTIFICATION_ENCRYPTION_KEY', async () => {
    for (const [key, value] of Object.entries(TEST_ENV)) vi.stubEnv(key, value);
    const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule.register(), CryptoModule] }).compile();
    const sealed = moduleRef.get(SecretCipher).encrypt(SECRET, LOCATION);

    expect(new SecretCipher(TEST_ENV.NOTIFICATION_ENCRYPTION_KEY).decrypt(sealed, LOCATION)).toBe(SECRET);
    expect(() => new SecretCipher(KEY).decrypt(sealed, LOCATION)).toThrow(SecretDecryptionError);
    await moduleRef.close();
  });
});
