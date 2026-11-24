// @vitest-environment node
// The release build (`vite build --mode cdn`): content-hashed bundles, release.json for the signer, no unsigned URL
// (KTD3, KTD12), and byte-identical bundles from two clean builds, which the TEST/PROD rebuild check needs (KTD7).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cdnBuildConfig, SEQUENCE_ENV, sha384Integrity, type ReleaseRecord } from '../../scripts/vite-builds.ts';
import { isBundlePath } from '../signing/manifest.ts';

const SEQUENCE = 1_795_000_000_000;

interface BuildOutput {
  files: Map<string, Buffer>;
  release: ReleaseRecord;
}

let workDir: string;

/** Builds the CDN tree into `<workDir>/<name>/cdn` and returns every served file and release.json. */
async function cleanBuild(name: string, sequence?: number): Promise<BuildOutput> {
  const outDir = join(workDir, name, 'cdn');
  const releaseFile = join(workDir, name, 'release.json');
  const previous = process.env[SEQUENCE_ENV];
  if (sequence === undefined) delete process.env[SEQUENCE_ENV];
  else process.env[SEQUENCE_ENV] = String(sequence);
  try {
    await build({ configFile: false, ...cdnBuildConfig({ outDir, releaseFile }) });
  } finally {
    if (previous === undefined) delete process.env[SEQUENCE_ENV];
    else process.env[SEQUENCE_ENV] = previous;
  }
  const paths = readdirSync(outDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(outDir.length + 1))
    .toSorted();
  const files = new Map(paths.map((path) => [path, readFileSync(join(outDir, path))]));
  const release: ReleaseRecord = JSON.parse(readFileSync(releaseFile, 'utf8'));
  return { files, release };
}

let first: BuildOutput;
let second: BuildOutput;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'shared-ui-build-'));
  first = await cleanBuild('first', SEQUENCE);
  second = await cleanBuild('second', SEQUENCE);
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('release build', () => {
  it('serves only one content-hashed bundle, and no unsigned header/v1/sdg-header.js', () => {
    const paths = [...first.files.keys()];
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/^header\/v1\/bundles\/sdg-header-[\w-]+\.js$/);
    expect(paths).not.toContain('header/v1/sdg-header.js');
  });

  it('writes release.json naming the served bundle, its sha384 and the build sequence', () => {
    const { release, files } = first;
    expect(isBundlePath(release.bundle.path)).toBe(true);
    const served = release.bundle.path.replace(/^\/shared-ui\//, '');
    expect([...files.keys()]).toEqual([served]);
    expect(release).toEqual({
      schema: 1,
      sequence: SEQUENCE,
      bundle: { path: release.bundle.path, integrity: sha384Integrity(files.get(served)!) },
    });
  });

  it('produces byte-identical bundles and release.json from two clean builds', () => {
    expect([...second.files.keys()]).toEqual([...first.files.keys()]);
    for (const [path, bytes] of first.files) expect(second.files.get(path)?.equals(bytes)).toBe(true);
    expect(second.release).toEqual(first.release);
  });

  it('stamps the build time as the sequence when no override is set', async () => {
    const before = Date.now();
    const { release } = await cleanBuild('unset');
    expect(release.sequence).toBeGreaterThanOrEqual(before);
    expect(release.sequence).toBeLessThanOrEqual(Date.now());
  });
});
