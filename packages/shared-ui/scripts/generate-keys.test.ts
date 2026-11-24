// @vitest-environment node
// Tests for packages/shared-ui/scripts/generate-keys.ts: offline key generation safety checks.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runGenerateKeys } from './generate-keys.ts';

let workDir: string;
let fakeRepo: string;
let keysDir: string;
let outsideDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'generate-keys-test-'));
  fakeRepo = join(workDir, 'repo');
  keysDir = join(fakeRepo, 'packages/shared-ui/keys');
  outsideDir = join(workDir, 'outside');
  mkdirSync(keysDir, { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('generate-keys', () => {
  it('writes public keys to keysDir and private keys outside the repo with 0600 mode, without printing private d', () => {
    const logged: string[] = [];
    const result = runGenerateKeys(['prod', '--out', outsideDir], {
      keysDir,
      repoRoot: fakeRepo,
      now: () => new Date('2026-11-23T00:00:00Z'),
      info: (line) => logged.push(line),
    });

    expect(result.publicFile).toBe(join(keysDir, 'prod.json'));
    expect(result.privateFiles).toHaveLength(2);

    const output = logged.join('\n');
    for (const file of result.privateFiles) {
      const mode = statSync(file).mode & 0o777;
      expect(mode).toBe(0o600);
      const jwk: { d?: string; kid?: string } = JSON.parse(readFileSync(file, 'utf8'));
      expect(typeof jwk.d).toBe('string');
      expect(output).not.toContain(jwk.d!);
    }

    const pub: { keyset: string; keys: Record<string, { d?: string }> } = JSON.parse(
      readFileSync(result.publicFile, 'utf8'),
    );
    expect(pub.keyset).toBe('prod');
    expect(Object.keys(pub.keys)).toEqual(['prod-primary-20261123', 'prod-backup-20261123']);
    for (const jwk of Object.values(pub.keys)) expect(jwk.d).toBeUndefined();
  });

  it('refuses to overwrite existing private key files (wx flag)', () => {
    const opts = {
      keysDir,
      repoRoot: fakeRepo,
      now: () => new Date('2026-11-23T00:00:00Z'),
      info: () => undefined,
    };
    runGenerateKeys(['test', '--out', outsideDir], opts);
    expect(() => runGenerateKeys(['test', '--out', outsideDir], opts)).toThrow(/EEXIST/);
  });

  it('refuses --out inside the repository directly or via a symlink', () => {
    const insidePath = join(fakeRepo, 'secrets');
    expect(() =>
      runGenerateKeys(['pr', '--out', insidePath], { keysDir, repoRoot: fakeRepo, info: () => undefined }),
    ).toThrow(/refusing to write private keys inside the repository/);

    const insideTarget = join(fakeRepo, 'link-target');
    mkdirSync(insideTarget, { recursive: true });
    const symlinkOut = join(workDir, 'symlink-to-repo');
    symlinkSync(insideTarget, symlinkOut);
    expect(() =>
      runGenerateKeys(['pr', '--out', symlinkOut], { keysDir, repoRoot: fakeRepo, info: () => undefined }),
    ).toThrow(/refusing to write private keys inside the repository/);
  });

  it('enforces dev vs non-dev --out rules', () => {
    expect(() =>
      runGenerateKeys(['dev', '--out', outsideDir], { keysDir, repoRoot: fakeRepo, info: () => undefined }),
    ).toThrow(/dev keyset takes no --out/);

    expect(() => runGenerateKeys(['prod'], { keysDir, repoRoot: fakeRepo, info: () => undefined })).toThrow(
      /--out is required for keyset "prod"/,
    );

    const devResult = runGenerateKeys(['dev'], {
      keysDir,
      repoRoot: fakeRepo,
      now: () => new Date('2026-11-23T00:00:00Z'),
      info: () => undefined,
    });
    expect(devResult.privateFiles).toEqual([join(keysDir, 'dev.private.json')]);
  });
});
