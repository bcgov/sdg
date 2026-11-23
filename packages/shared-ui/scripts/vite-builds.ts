// The two browser IIFE builds behind vite.config.ts (KTD5, KTD12): the release bundle (`--mode cdn`) and a keyset's
// loader (`build:loaders` only). Exported as functions so tests can build into a temporary folder.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { defineLibraryConfig } from '@repo/vite-config';
import type { Plugin, UserConfig } from 'vite';

import { HEADER_PATHS } from '../src/header/contract.ts';
import { formatJson, PACKAGE_ROOT, type PublicKeys } from './keysets.ts';

/** Overrides `release.json`'s build sequence (ms), e.g. to compare two builds of one commit byte for byte. */
export const SEQUENCE_ENV = 'HEADER_BUILD_SEQUENCE';

/** `release.json` (KTD3, KTD7): what the signer needs from a build. Written outside the served tree. */
export interface ReleaseRecord {
  schema: 1;
  /** Build time in ms, or `HEADER_BUILD_SEQUENCE`; every signature of this build carries it. */
  sequence: number;
  bundle: { path: string; integrity: string };
}

// The element is Preact; React files under src/header/react override this with a @jsxImportSource pragma.
export const oxc: UserConfig['oxc'] = { jsx: { runtime: 'automatic', importSource: 'preact' } };

const fromRoot = (path: string): string => (isAbsolute(path) ? path : resolve(PACKAGE_ROOT, path));

export function sha384Integrity(bytes: Uint8Array | string): string {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

function buildSequence(): number {
  const override = process.env[SEQUENCE_ENV];
  if (override === undefined || override === '') return Date.now();
  const sequence = Number(override);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error(`${SEQUENCE_ENV} must be a non-negative integer (ms), got "${override}"`);
  }
  return sequence;
}

/** Writes `release.json` for the build's one entry chunk, hashing the bytes as written. */
function releaseJson(releaseFile: string): Plugin {
  return {
    name: 'shared-ui:release-json',
    writeBundle(options, bundle) {
      const entries = Object.values(bundle).filter((output) => output.type === 'chunk' && output.isEntry);
      const [entry] = entries;
      if (entries.length !== 1 || !entry || !options.dir) this.error('the CDN build must emit exactly one entry');
      const bytes = readFileSync(join(options.dir, entry.fileName));
      const record: ReleaseRecord = {
        schema: 1,
        sequence: buildSequence(),
        bundle: { path: `/shared-ui/${entry.fileName}`, integrity: sha384Integrity(bytes) },
      };
      mkdirSync(dirname(releaseFile), { recursive: true });
      writeFileSync(releaseFile, formatJson(record));
    },
  };
}

/** One classic IIFE script from `input`, everything bundled, no chunks, minified, no source map. */
function iifeConfig(input: string, outDir: string, fileName: string, extra: UserConfig): UserConfig {
  return defineLibraryConfig({
    platform: 'browser',
    entry: {},
    overrides: {
      ...extra,
      oxc,
      root: PACKAGE_ROOT,
      logLevel: 'warn',
      build: {
        // Not library mode: lib.formats would merge with the default ['es'] instead of replacing it.
        lib: false,
        outDir: fromRoot(outDir),
        emptyOutDir: true,
        copyPublicDir: false,
        sourcemap: false,
        minify: true,
        rolldownOptions: {
          input: fromRoot(input),
          external: () => false,
          output: { format: 'iife', entryFileNames: fileName, codeSplitting: false },
        },
      },
    },
  });
}

export interface CdnBuildOptions {
  /** Served tree; the image copies it to /srv. */
  outDir?: string;
  /** Outside `outDir`, so it is never served. */
  releaseFile?: string;
}

/**
 * The release bundle: `<outDir>/header/v1/bundles/sdg-header-<hash>.js`, content-hashed so it can be cached as
 * immutable, plus `release.json`. No unsigned `header/v1/sdg-header.js` (KTD12).
 */
export function cdnBuildConfig({
  outDir = 'dist/cdn',
  releaseFile = 'dist/release.json',
}: CdnBuildOptions = {}): UserConfig {
  return iifeConfig('src/header/element/cdn.ts', outDir, `${HEADER_PATHS.bundles}sdg-header-[hash].js`, {
    plugins: [releaseJson(fromRoot(releaseFile))],
  });
}

export interface LoaderBuildOptions {
  keyset: string;
  keys: PublicKeys;
  outDir: string;
}

/** A keyset's loader (KTD5): `src/loader/cdn.ts` with the keyset and its public keys baked in, as `loader.js`. */
export function loaderBuildConfig({ keyset, keys, outDir }: LoaderBuildOptions): UserConfig {
  return iifeConfig('src/loader/cdn.ts', outDir, 'loader.js', {
    define: { SDG_HEADER_KEYSET: JSON.stringify(keyset), SDG_HEADER_KEYS: JSON.stringify(keys) },
  });
}
