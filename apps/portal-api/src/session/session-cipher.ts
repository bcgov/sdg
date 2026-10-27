import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/** Derives the store's encryption key from SESSION_SECRET, so rotating the secret also retires stored sessions. */
export function deriveSessionKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, '', 'portal-session-store', 32));
}

/** AES-256-GCM as `iv.tag.ciphertext` (base64url). `aad` binds the payload to its row (the session id). */
export function encryptSession(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

/** Throws when the payload is malformed, tampered with, bound to another id or sealed with another key. */
export function decryptSession(key: Buffer, payload: string, aad: string): string {
  const [iv, tag, ciphertext, ...rest] = payload.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !ciphertext || rest.length > 0 || iv.length !== IV_BYTES) {
    throw new Error('Malformed session payload');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
