// The dev server's stand-ins for what deployed environments get from the chart and the edge: the
// committed dev loader at /header/v1/loader.js, a manifest signed with the committed dev key (re-signed after every
// rebuild) at /header/v1/manifest.json, and the loader's { src, integrity } at /header/v1/loader.json.
import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';

import type { Plugin } from 'vite';

import { HEADER_PATHS } from '../src/header/contract.ts';
import type { ManifestEnvelope } from '../src/signing/envelope.ts';
import { MANIFEST_SCHEMA } from '../src/signing/manifest.ts';
import { signManifest, type SigningKey } from '../src/signing/sign.ts';
import {
  DAY_MS,
  DEFAULT_TTL_DAYS,
  DEV_KEYSET,
  KEYS_DIR,
  LOADERS_DIR,
  LOADERS_LOCK,
  type Jwk,
  type LoadersLock,
} from './keysets.ts';
import type { ReleaseRecord } from './vite-builds.ts';

/** The committed dev primary key (keys/dev.private.json): trusted only by the dev loader. */
function devSigningKey(): SigningKey {
  const file: { keys: Record<string, Jwk> } = JSON.parse(readFileSync(`${KEYS_DIR}${DEV_KEYSET}.private.json`, 'utf8'));
  const entry = Object.entries(file.keys).find(([keyId]) => keyId.startsWith(`${DEV_KEYSET}-primary-`));
  if (!entry) throw new Error('keys/dev.private.json has no dev primary key');
  return { keyId: entry[0], privateKey: createPrivateKey({ key: entry[1], format: 'jwk' }) };
}

/** Signs a dev manifest for the build described by `releaseFile`, floor 0, expiring in 90 days. */
export function signDevManifest(releaseFile: string): ManifestEnvelope {
  const release: ReleaseRecord = JSON.parse(readFileSync(releaseFile, 'utf8'));
  const now = Date.now();
  return signManifest(
    {
      schema: MANIFEST_SCHEMA,
      keyset: DEV_KEYSET,
      version: `dev-${release.sequence}`,
      sequence: release.sequence,
      floor: 0,
      issuedAt: now,
      expires: now + DEFAULT_TTL_DAYS * DAY_MS,
      bundle: release.bundle,
    },
    devSigningKey(),
  );
}

function send(res: ServerResponse, contentType: string, body: string): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-cache');
  res.end(body);
}

/** Preview-server routes for the loader, the current dev manifest and loader.json. */
export function devHeaderRoutes(currentManifest: () => ManifestEnvelope | undefined): Plugin {
  const routes: Record<string, (res: ServerResponse) => void> = {
    [`/${HEADER_PATHS.loader}`]: (res) =>
      send(res, 'text/javascript', readFileSync(`${LOADERS_DIR}${DEV_KEYSET}/loader.js`, 'utf8')),
    [`/${HEADER_PATHS.loaderConfig}`]: (res) => {
      const lock: LoadersLock = JSON.parse(readFileSync(LOADERS_LOCK, 'utf8'));
      const config = { src: `/shared-ui/${HEADER_PATHS.loader}`, integrity: lock[DEV_KEYSET]?.integrity };
      send(res, 'application/json', JSON.stringify(config));
    },
    [`/${HEADER_PATHS.manifest}`]: (res) => {
      const manifest = currentManifest();
      if (manifest) send(res, 'application/json', JSON.stringify(manifest));
      else {
        res.statusCode = 503;
        res.end('the first build has not finished');
      }
    },
  };
  return {
    name: 'shared-ui:dev-header-routes',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const route = routes[new URL(req.url ?? '/', 'http://localhost').pathname];
        if (route) route(res);
        else next();
      });
    },
  };
}
