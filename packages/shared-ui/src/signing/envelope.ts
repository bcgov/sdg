// The signed envelope (KTD2): `manifest.json` is `{ keyId, payload, sig }`. `payload` is the base64url of the exact
// manifest bytes, and `sig` (ECDSA P-256 / SHA-256, IEEE P1363, KTD1) covers `SIGNATURE_DOMAIN` followed by those
// bytes. Browser-safe.
import { isRecord } from './manifest.ts';

/** Domain separation: a signature over these manifest bytes can't be mistaken for one over anything else. */
export const SIGNATURE_DOMAIN = 'sdg-header-manifest-v1\n';

export interface ManifestEnvelope {
  /** Names the trusted public key that made `sig`. Unsigned, so it only selects a key. */
  keyId: string;
  /** base64url (no padding) of the manifest's JSON bytes. */
  payload: string;
  /** base64url (no padding) of the 64-byte P1363 signature. */
  sig: string;
}

const BASE64URL = /^[A-Za-z0-9_-]*$/;

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** The decoded bytes, or `undefined` when `text` is not unpadded base64url. */
export function decodeBase64Url(text: string): Uint8Array | undefined {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return undefined;
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The bytes a signature covers: `SIGNATURE_DOMAIN` followed by the manifest bytes. */
export function signedBytes(payloadBytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const prefix = new TextEncoder().encode(SIGNATURE_DOMAIN);
  const out = new Uint8Array(prefix.length + payloadBytes.length);
  out.set(prefix);
  out.set(payloadBytes, prefix.length);
  return out;
}

/** The envelope when `value` has string `keyId`, `payload` and `sig`, else `undefined`. */
export function parseEnvelope(value: unknown): ManifestEnvelope | undefined {
  if (!isRecord(value)) return undefined;
  const { keyId, payload, sig } = value;
  if (typeof keyId !== 'string' || typeof payload !== 'string' || typeof sig !== 'string') return undefined;
  return { keyId, payload, sig };
}
