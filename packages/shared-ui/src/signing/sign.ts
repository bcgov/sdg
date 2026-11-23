// Node-only signer (KTD1): ECDSA P-256 / SHA-256 with IEEE P1363 signatures, which WebCrypto verifies. Used by the
// signing scripts and tests; never import it from a browser entry (tsconfig.lib.json leaves it out, so a browser
// import fails the typecheck on `node:crypto`).
import { sign, type KeyObject } from 'node:crypto';

import { encodeBase64Url, signedBytes, type ManifestEnvelope } from './envelope.ts';
import type { ManifestPayload } from './manifest.ts';

export interface SigningKey {
  /** The `keyId` loaders know the matching public key by. */
  keyId: string;
  /** A P-256 private key. */
  privateKey: KeyObject;
}

/** Signs the JSON bytes of `payload` and wraps them in the envelope served as `manifest.json`. */
export function signManifest(payload: ManifestPayload, key: SigningKey): ManifestEnvelope {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = sign('sha256', signedBytes(payloadBytes), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return { keyId: key.keyId, payload: encodeBase64Url(payloadBytes), sig: encodeBase64Url(sig) };
}
