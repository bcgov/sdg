// `pnpm dev`: the local stand-in for the shared-ui server. Rebuilds the release bundle on every change
// (`vite build --mode cdn --watch`) and serves dist/cdn like the production image does, plus the dev loader at
// /header/v1/loader.js, a manifest signed with the dev key and re-signed after every rebuild at /header/v1/manifest.json,
// and /header/v1/loader.json (scripts/dev-header.ts). The loader resolves the manifest and bundle under /shared-ui/, so
// it works behind portal-web's Vite proxy and compose's Caddy, which strip that prefix. `--host <addr>` listens beyond
// localhost (compose).
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { build, preview, type Rolldown } from 'vite';

import type { ManifestEnvelope } from '../src/signing/envelope.ts';
import { devHeaderRoutes, signDevManifest } from './dev-header.ts';

const SHARED_UI_DEV_PORT = 5180;

const root = fileURLToPath(new URL('..', import.meta.url));
const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const releaseFile = fileURLToPath(new URL('../dist/release.json', import.meta.url));

let manifest: ManifestEnvelope | undefined;

/** Re-signs the dev manifest for the build that just finished; a failure keeps the previous one, logged. */
function resign(): void {
  try {
    manifest = signDevManifest(releaseFile);
  } catch (error: unknown) {
    console.error('shared-ui dev server: cannot sign the dev manifest', { releaseFile, error });
  }
}

// Bind-mount file events don't reliably cross the Podman VM; compose sets CHOKIDAR_USEPOLLING to poll instead. Vite 8
// derives rolldown's `watcher` options from `chokidar` (overwriting any `watcher` given), which rolldown's type omits.
const pollingWatch: Rolldown.WatcherOptions & { chokidar: { usePolling: boolean } } = {
  chokidar: { usePolling: process.env['CHOKIDAR_USEPOLLING'] === 'true' },
};

/**
 * Starts the watch build, re-signing the manifest after every successful build, and resolves once its first build has
 * finished (or failed: the watcher keeps going).
 */
async function watchCdnBundle(): Promise<Rolldown.RolldownWatcher> {
  const watcher = await build({
    root,
    configFile,
    mode: 'cdn',
    build: { watch: pollingWatch },
  });
  if (!('on' in watcher)) throw new Error('vite build did not start in watch mode');
  watcher.on('event', (event) => {
    if (event.code === 'BUNDLE_END') resign();
  });
  await new Promise<void>((resolve) => {
    const onEvent = (event: Rolldown.RolldownWatcherEvent): void => {
      if (event.code === 'END' || event.code === 'ERROR') {
        watcher.off('event', onEvent);
        resolve();
      }
    };
    watcher.on('event', onEvent);
  });
  return watcher;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { host: { type: 'string' } } });
  const watcher = await watchCdnBundle();
  // In case the first build ended before the BUNDLE_END listener was attached.
  if (!manifest) resign();
  const server = await preview({
    root,
    configFile,
    mode: 'cdn',
    // Serve all of dist/cdn, not just this major's directory; no SPA fallback, so a missing file is a 404.
    appType: 'custom',
    plugins: [devHeaderRoutes(() => manifest)],
    build: { outDir: 'dist/cdn' },
    preview: { port: SHARED_UI_DEV_PORT, strictPort: true, host: values.host ?? 'localhost' },
  });
  server.printUrls();

  const stop = (): void => {
    void Promise.all([watcher.close(), server.close()]).then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

process.on('unhandledRejection', (reason) => {
  console.error('shared-ui dev server: unhandled rejection', reason);
  process.exit(1);
});

try {
  await main();
} catch (error: unknown) {
  console.error('shared-ui dev server failed to start', error);
  process.exit(1);
}
