// Verifies a signed manifest with WebCrypto (KTD1, KTD2): usable from the browser loader and from Node scripts.
// Browser-safe: never import ./sign.ts (Node-only) from here.
import { decodeBase64Url, parseEnvelope, signedBytes } from './envelope.ts';
import { isBundlePath, parsePayload, type ManifestPayload } from './manifest.ts';

/** Structural public JWK shape usable across browser DOM and Node WebCrypto without ambient globals. */
export interface PublicJwk {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  ext?: boolean;
  key_ops?: string[];
}

/** Trusted P-256 public keys in JWK form, keyed by `keyId` (a keyset's primary and backup, R7). */
export type TrustedKeys = Readonly<Record<string, PublicJwk>>;

export interface VerifyOptions {
  keys: TrustedKeys;
  /** The keyset this verifier serves; a payload for any other keyset is refused. */
  keyset: string;
  /** Current time, ms since the epoch. */
  now: number;
  /** The caller's floor (e.g. the visitor's remembered one); the effective floor is the higher of this and the manifest's. */
  floor: number;
  /** Header major version whose bundle prefix is allowed (defaults to `HEADER_MAJOR`). */
  major?: number;
  /** Skip the expiry check. Only for re-signing CI's own verified record (KTD7); never in the loader. */
  acceptExpired?: boolean;
}

export type VerifyFailure =
  | 'bad-signature'
  | 'unknown-key'
  | 'malformed'
  | 'wrong-keyset'
  | 'expired'
  | 'below-floor'
  | 'bad-bundle-path'
  | 'crypto-unavailable';

export type VerifyResult = { ok: true; payload: ManifestPayload } | { ok: false; reason: VerifyFailure };

const fail = (reason: VerifyFailure): VerifyResult => ({ ok: false, reason });

function subtleCrypto(): SubtleCrypto | undefined {
  return (globalThis as { crypto?: Partial<Crypto> }).crypto?.subtle;
}

/** True when `sig` is a valid signature by `jwk` over the domain-prefixed `payloadBytes`. Throws on crypto errors. */
async function signatureValid(
  subtle: SubtleCrypto,
  jwk: PublicJwk,
  sig: Uint8Array<ArrayBuffer>,
  payloadBytes: Uint8Array,
): Promise<boolean> {
  const key = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, signedBytes(payloadBytes));
}

function decodePayload(bytes: Uint8Array): ManifestPayload | undefined {
  try {
    return parsePayload(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    // Not UTF-8 or not JSON: the caller reports `malformed`.
    return undefined;
  }
}

/** Checks a verified payload against the caller's keyset, clock and floor. */
function checkPayload(payload: ManifestPayload, options: VerifyOptions): VerifyResult {
  if (payload.keyset !== options.keyset) return fail('wrong-keyset');
  if (!isBundlePath(payload.bundle.path, options.major)) return fail('bad-bundle-path');
  if (!options.acceptExpired && options.now >= payload.expires) return fail('expired');
  if (payload.sequence < Math.max(options.floor, payload.floor)) return fail('below-floor');
  return { ok: true, payload };
}

/**
 * Verifies `value` (the parsed `manifest.json`) and returns its payload, or why it was refused. The payload is read
 * only after the signature verifies. Never throws.
 */
export async function verifyManifest(value: unknown, options: VerifyOptions): Promise<VerifyResult> {
  const envelope = parseEnvelope(value);
  const payloadBytes = envelope && decodeBase64Url(envelope.payload);
  const sig = envelope && decodeBase64Url(envelope.sig);
  if (!envelope || !payloadBytes || !sig) return fail('malformed');
  if (!Object.hasOwn(options.keys, envelope.keyId)) return fail('unknown-key');
  const jwk = options.keys[envelope.keyId]!;
  const subtle = subtleCrypto();
  if (!subtle) return fail('crypto-unavailable');
  let valid: boolean;
  try {
    valid = await signatureValid(subtle, jwk, new Uint8Array(sig), payloadBytes);
  } catch {
    // The browser can't import a P-256 key or verify ECDSA: treat as no WebCrypto, never as a pass.
    return fail('crypto-unavailable');
  }
  if (!valid) return fail('bad-signature');
  const payload = decodePayload(payloadBytes);
  return payload ? checkPayload(payload, options) : fail('malformed');
}
