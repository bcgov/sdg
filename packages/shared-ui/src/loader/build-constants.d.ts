// Constants the loader build injects per keyset with Vite `define`: the loader carries its keyset's public keys
// and nothing else.
import type { TrustedKeys } from '../signing/verify.ts';

declare global {
  /** The keyset this built loader serves (`pr`, `test`, `prod`, `dev`). */
  const SDG_HEADER_KEYSET: string;
  /** The keyset's primary and backup public keys in JWK form, keyed by `keyId`. */
  const SDG_HEADER_KEYS: TrustedKeys;
}
