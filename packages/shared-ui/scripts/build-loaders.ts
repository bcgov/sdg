// `pnpm --filter @repo/shared-ui build:loaders`: rebuilds loaders/<keyset>/loader.js for every keys/<keyset>.json and
// rewrites loaders.lock.json with each loader's sha384. The only way the committed loaders change: their bytes
// are what sites pin with `integrity`, so a changed loader is a breaking change for every embedding site of that
// keyset. The normal build never runs this; the image copies the committed bytes.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { build } from 'vite';

import { formatJson, listKeysets, LOADERS_DIR, LOADERS_LOCK, readKeyset, type LoadersLock } from './keysets.ts';
import { loaderBuildConfig, sha384Integrity } from './vite-builds.ts';

async function buildLoader(keyset: string): Promise<[string, { integrity: string }]> {
  const { keys } = readKeyset(keyset);
  const outDir = join(LOADERS_DIR, keyset);
  await build({ configFile: false, ...loaderBuildConfig({ keyset, keys, outDir }) });
  return [keyset, { integrity: sha384Integrity(readFileSync(join(outDir, 'loader.js'))) }];
}

async function main(): Promise<void> {
  const keysets = listKeysets();
  if (keysets.length === 0) throw new Error('no keys/<keyset>.json files to build loaders for');
  // A loader whose keyset file is gone is stale: remove it rather than keep serving keys nobody holds.
  rmSync(LOADERS_DIR, { recursive: true, force: true });
  const lock: LoadersLock = Object.fromEntries(await Promise.all(keysets.map(buildLoader)));
  writeFileSync(LOADERS_LOCK, formatJson(lock));
  for (const [keyset, { integrity }] of Object.entries(lock)) console.info(`loaders/${keyset}/loader.js ${integrity}`);
  console.info(
    'Commit loaders/ and loaders.lock.json; every site embedding a changed loader must update its integrity.',
  );
}

process.on('unhandledRejection', (reason) => {
  console.error('build:loaders: unhandled rejection', reason);
  process.exit(1);
});

try {
  await main();
} catch (error: unknown) {
  console.error('build:loaders failed', error);
  process.exit(1);
}
