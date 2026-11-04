import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const FORMAT = 'v1';
/** HKDF info strings: this service's own, so the same secret elsewhere yields unrelated keys. */
const KEY_INFO = 'notification-api secret-cipher key';
const KEY_ID_INFO = 'notification-api secret-cipher key id';

/** Where a sealed value is stored. Bound as AAD, so a sealed value copied to another row or field won't decrypt. */
export interface SecretLocation {
  /** The owning row's id. */
  rowId: string;
  /** The field path inside the row, e.g. `config.password`. */
  field: string;
}

/** A sealed secret could not be opened. The message never contains the value. */
export class SecretDecryptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SecretDecryptionError';
  }
}

/**
 * AES-256-GCM for secrets stored in the database (KTD11), keyed by HKDF from NOTIFICATION_ENCRYPTION_KEY.
 * A sealed value is `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url parts). The key id is derived from the secret,
 * so a value names the key that sealed it and rotating the secret is a re-wrap (decrypt with the old key, encrypt
 * with the new). The format, key id, row id and field path are the AAD.
 */
export class SecretCipher {
  /** Identifies the configured key in every value it seals. Not secret. */
  readonly keyId: string;
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync('sha256', secret, '', KEY_INFO, 32));
    this.keyId = Buffer.from(hkdfSync('sha256', secret, '', KEY_ID_INFO, 6)).toString('base64url');
  }

  encrypt(plaintext: string, location: SecretLocation): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(this.aad(this.keyId, location));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const parts = [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url'));
    return [FORMAT, this.keyId, ...parts].join('.');
  }

  /** Throws a {@link SecretDecryptionError} when the value is malformed, sealed with another key, tampered with or bound elsewhere. */
  decrypt(sealed: string, location: SecretLocation): string {
    const [format, keyId, ...encoded] = sealed.split('.');
    const [iv, tag, ciphertext, ...rest] = encoded.map((part) => Buffer.from(part, 'base64url'));
    if (format !== FORMAT || !keyId || !iv || !tag || !ciphertext || rest.length > 0 || iv.length !== IV_BYTES) {
      throw new SecretDecryptionError('Malformed sealed secret');
    }
    if (keyId !== this.keyId) {
      throw new SecretDecryptionError(
        `Secret was sealed with key id ${keyId}, but the configured key id is ${this.keyId}: re-wrap it with the key that sealed it`,
      );
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAAD(this.aad(keyId, location));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (error) {
      const message = 'Sealed secret failed authentication: tampered with, or bound to another row or field';
      throw new SecretDecryptionError(message, { cause: error });
    }
  }

  private aad(keyId: string, location: SecretLocation): Buffer {
    return Buffer.from(JSON.stringify([FORMAT, keyId, location.rowId, location.field]));
  }
}
