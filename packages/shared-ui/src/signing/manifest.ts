// The signed manifest's payload (KTD2): what a release says about itself. Browser-safe; shared by the loader, the
// signer and the signing scripts. Relative imports in src/signing use `.ts` so Node scripts can run them directly.

export const MANIFEST_SCHEMA = 1;

/** Bundles are served only from here, on the loader's own origin (KTD2). */
export const BUNDLE_PATH_PREFIX = '/shared-ui/header/v1/bundles/';

export interface ManifestBundle {
  /** Root-relative, content-hashed path under `BUNDLE_PATH_PREFIX`; resolved against the loader's origin. */
  path: string;
  /** The bundle's Subresource Integrity value (`sha384-…`), used as the script's `integrity`. */
  integrity: string;
}

export interface ManifestPayload {
  schema: typeof MANIFEST_SCHEMA;
  /** The keyset whose loaders may accept this manifest (`pr`, `test`, `prod`, `dev`). */
  keyset: string;
  /** Display label only; ordering uses `sequence`. */
  version: string;
  /** The build sequence from `release.json` (build time in ms), the same in every signature of that build (KTD3). */
  sequence: number;
  /** The lowest sequence allowed to load (KTD3). */
  floor: number;
  /** Signing time, ms since the epoch. */
  issuedAt: number;
  /** Expiry, ms since the epoch. */
  expires: number;
  bundle: ManifestBundle;
}

// One file name of letters, digits, `_`, `-` and single dots, ending in `.js`: no `..`, `/`, `%`, `?` or `#`.
const BUNDLE_PATH = /^\/shared-ui\/header\/v1\/bundles\/[\w-]+(?:\.[\w-]+)*\.js$/;
// sha384 is 48 bytes: 64 base64 characters, no padding.
const SHA384_INTEGRITY = /^sha384-[A-Za-z0-9+/]{64}$/;

/** True when `path` is a root-relative bundle path under `BUNDLE_PATH_PREFIX`, so it can't leave the loader's origin. */
export function isBundlePath(path: string): boolean {
  return BUNDLE_PATH.test(path);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isBundle(value: unknown): value is ManifestBundle {
  return (
    isRecord(value) &&
    typeof value['path'] === 'string' &&
    typeof value['integrity'] === 'string' &&
    SHA384_INTEGRITY.test(value['integrity'])
  );
}

/**
 * The payload when `value` matches the schema, else `undefined`. The bundle path's shape is checked separately
 * (`isBundlePath`), so a refusal can say which rule failed.
 */
export function parsePayload(value: unknown): ManifestPayload | undefined {
  if (!isRecord(value) || value['schema'] !== MANIFEST_SCHEMA) return undefined;
  const { keyset, version, sequence, floor, issuedAt, expires, bundle } = value;
  if (typeof keyset !== 'string' || typeof version !== 'string' || version === '') return undefined;
  if (!isCount(sequence) || !isCount(floor) || !isCount(issuedAt) || !isCount(expires)) return undefined;
  if (!isBundle(bundle)) return undefined;
  return {
    schema: MANIFEST_SCHEMA,
    keyset,
    version,
    sequence,
    floor,
    issuedAt,
    expires,
    bundle: { path: bundle.path, integrity: bundle.integrity },
  };
}
