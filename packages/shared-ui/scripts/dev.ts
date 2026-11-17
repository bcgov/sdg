// `pnpm dev`: the local stand-in for the shared-ui server (KTD13). Rebuilds the CDN bundle on every change
// (`vite build --mode cdn --watch`) and serves dist/cdn like the production image does, so
// http://localhost:5180/header/v1/sdg-header.js is the script the edge serves at /shared-ui/header/v1/sdg-header.js.
// portal-web's Vite proxy and compose's Caddy reach it there. `--host <addr>` listens beyond localhost (compose).
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { build, preview, type Rolldown } from 'vite';

const SHARED_UI_DEV_PORT = 5180;

const root = fileURLToPath(new URL('..', import.meta.url));
const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));

// Bind-mount file events don't reliably cross the Podman VM; compose sets CHOKIDAR_USEPOLLING to poll instead. Vite 8
// derives rolldown's `watcher` options from `chokidar` (overwriting any `watcher` given), which rolldown's type omits.
const pollingWatch = {
  chokidar: { usePolling: process.env['CHOKIDAR_USEPOLLING'] === 'true' },
} as Rolldown.WatcherOptions;

/** Starts the watch build and resolves once its first build has finished (or failed: the watcher keeps going). */
async function watchCdnBundle(): Promise<Rolldown.RolldownWatcher> {
  const watcher = await build({
    root,
    configFile,
    mode: 'cdn',
    build: { watch: pollingWatch },
  });
  if (!('on' in watcher)) throw new Error('vite build did not start in watch mode');
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
  const server = await preview({
    root,
    configFile,
    mode: 'cdn',
    // Serve all of dist/cdn, not just this major's directory; no SPA fallback, so a missing file is a 404.
    appType: 'custom',
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

main().catch((error: unknown) => {
  console.error('shared-ui dev server failed to start', error);
  process.exit(1);
});
