// The header's integrity checks in a real browser (AE1–AE7). AE1–AE6 run the committed dev loader on a routed fixture
// origin, with manifests signed here with the committed dev key, so they judge the loader's own checks the same way
// against local and deployed environments. AE7 and the happy path use the environment's own loader.
import { createHash, createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { test } from '@repo/playwright-config';

import { decodeBase64Url, type ManifestEnvelope } from '../../../packages/shared-ui/src/signing/envelope.ts';
import {
  MANIFEST_SCHEMA,
  type ManifestBundle,
  type ManifestPayload,
} from '../../../packages/shared-ui/src/signing/manifest.ts';
import { signManifest, type SigningKey } from '../../../packages/shared-ui/src/signing/sign.ts';
import { environmentLoader, LOADER_PATH, serveExternalSite } from './external-site';

const SHARED_UI = new URL('../../../packages/shared-ui/', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, SHARED_UI), 'utf8');

const FIXTURE_ORIGIN = 'https://sdg-fixture.example';
const FLOOR_KEY = 'sdg-header:floor:dev:v1';
const DAY_MS = 86_400_000;
const CORS = { 'Access-Control-Allow-Origin': '*' };

const DEV_LOADER = read('loaders/dev/loader.js');
const DEV_LOADER_INTEGRITY: string = JSON.parse(read('loaders.lock.json')).dev.integrity;

/** The committed dev primary key, which only the dev loader trusts. */
function devKey(): SigningKey {
  const { keys }: { keys: Record<string, JsonWebKey> } = JSON.parse(read('keys/dev.private.json'));
  const [keyId, jwk] = Object.entries(keys).find(([id]) => id.startsWith('dev-primary-'))!;
  return { keyId, privateKey: createPrivateKey({ key: jwk, format: 'jwk' }) };
}

const sha384 = (bytes: string | Buffer): string => `sha384-${createHash('sha384').update(bytes).digest('base64')}`;

/** The environment's current bundle: its path from the live manifest and its bytes. */
async function liveBundle(request: APIRequestContext, baseURL: string | undefined) {
  const response = await request.get(new URL('/shared-ui/header/v1/manifest.json', baseURL).href);
  expect(response.ok()).toBe(true);
  const envelope: ManifestEnvelope = await response.json();
  const payload: { bundle: ManifestBundle } = JSON.parse(new TextDecoder().decode(decodeBase64Url(envelope.payload)));
  const body = await (await request.get(new URL(payload.bundle.path, baseURL).href)).body();
  return { path: payload.bundle.path, body };
}

interface Release {
  sequence: number;
  floor: number;
  expires?: number;
  key?: SigningKey;
}

type Fixture = Awaited<ReturnType<typeof serveFixture>>;

/**
 * Serves the dev loader, the current manifest and the bundle (altered when `tamper` is set) on the fixture origin,
 * and an external site whose loader tag points there.
 */
async function serveFixture(page: Page, baseURL: string | undefined) {
  const bundle = await liveBundle(page.request, baseURL);
  const release = { tamper: false, manifest: undefined as ManifestEnvelope | undefined };
  await page.route(`${FIXTURE_ORIGIN}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === LOADER_PATH) {
      return route.fulfill({ headers: CORS, contentType: 'text/javascript', body: DEV_LOADER });
    }
    if (pathname === '/shared-ui/header/v1/manifest.json' && release.manifest) {
      return route.fulfill({ headers: CORS, json: release.manifest });
    }
    if (pathname === bundle.path) {
      const body = release.tamper ? Buffer.concat([bundle.body, Buffer.from('\n;void 0;\n')]) : bundle.body;
      return route.fulfill({ headers: CORS, contentType: 'text/javascript', body });
    }
    return route.fulfill({ status: 404, headers: CORS });
  });
  const loader = { src: `${FIXTURE_ORIGIN}${LOADER_PATH}`, integrity: DEV_LOADER_INTEGRITY };
  const external = await serveExternalSite({ page, baseURL, loader });
  const serve = ({ sequence, floor, expires = Date.now() + 90 * DAY_MS, key = devKey() }: Release) => {
    const payload: ManifestPayload = {
      schema: MANIFEST_SCHEMA,
      keyset: 'dev',
      version: `e2e-${sequence}`,
      sequence,
      floor,
      issuedAt: Math.min(Date.now(), expires - DAY_MS),
      expires,
      bundle: { path: bundle.path, integrity: sha384(bundle.body) },
    };
    release.manifest = signManifest(payload, key);
  };
  return { external, release, serve };
}

/** Sets (or clears) this browser's remembered floor on the external site, from a page of that site with no loader. */
async function presetFloor(page: Page, { external }: Fixture, floor: number | undefined) {
  const blank = `${external}preset-floor`;
  await page.route(blank, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>-</title>' }),
  );
  await page.goto(blank);
  await page.evaluate(
    ({ key, value }) => (value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value)),
    { key: FLOOR_KEY, value: floor === undefined ? null : String(floor) },
  );
}

/** Resolves with the `reason` logged with the loader's next console error starting with `message`, if any. */
function nextLoaderError(page: Page, message: string): Promise<string | undefined> {
  return page
    .waitForEvent('console', { predicate: (entry) => entry.type() === 'error' && entry.text().startsWith(message) })
    .then(async (entry) => {
      const detail: unknown = await entry.args()[1]?.jsonValue();
      const reason: unknown = typeof detail === 'object' && detail !== null ? Reflect.get(detail, 'reason') : undefined;
      return typeof reason === 'string' ? reason : undefined;
    });
}

const refusal = (page: Page) => nextLoaderError(page, 'shared-ui: header manifest refused');

async function expectNoHeader(page: Page) {
  expect(await page.evaluate(() => customElements.get('sdg-header') === undefined)).toBe(true);
  // The pre-load rule's reserved band stays, empty.
  expect((await page.locator('sdg-header').boundingBox())?.height).toBe(104);
  await expect(page.getByRole('link', { name: 'Log In' })).toHaveCount(0);
}

async function expectHeader(page: Page) {
  await expect(page.locator('sdg-header').getByRole('link', { name: 'Log In' })).toHaveAttribute('href', '/x');
}

test.describe('shared header integrity', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('AE1: a bundle whose bytes differ from the manifest hash never runs, even after the retry', async ({
    page,
    baseURL,
  }) => {
    const fixture = await serveFixture(page, baseURL);
    await presetFloor(page, fixture, undefined);
    fixture.serve({ sequence: 300, floor: 0 });
    fixture.release.tamper = true;
    const failed = nextLoaderError(page, 'shared-ui: header bundle failed to load after a retry');
    await page.goto(fixture.external);
    await failed;
    await expectNoHeader(page);
  });

  test('AE2: a manifest signed with a key the loader does not trust is refused', async ({ page, baseURL }) => {
    const fixture = await serveFixture(page, baseURL);
    await presetFloor(page, fixture, undefined);
    // The attacker's own P-256 key, presented under the dev primary key's id.
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    fixture.serve({ sequence: 300, floor: 0, key: { keyId: devKey().keyId, privateKey } });
    const refused = refusal(page);
    await page.goto(fixture.external);
    expect(await refused).toBe('bad-signature');
    await expectNoHeader(page);
  });

  test('AE3: a validly signed release below the remembered floor is refused', async ({ page, baseURL }) => {
    const fixture = await serveFixture(page, baseURL);
    await presetFloor(page, fixture, 200);
    fixture.serve({ sequence: 150, floor: 0 });
    const refused = refusal(page);
    await page.goto(fixture.external);
    expect(await refused).toBe('below-floor');
    await expectNoHeader(page);
  });

  test('AE4: an expired, validly signed manifest is refused with no remembered floor', async ({ page, baseURL }) => {
    const fixture = await serveFixture(page, baseURL);
    await presetFloor(page, fixture, undefined);
    fixture.serve({ sequence: 300, floor: 0, expires: Date.now() - DAY_MS });
    const refused = refusal(page);
    await page.goto(fixture.external);
    expect(await refused).toBe('expired');
    await expectNoHeader(page);
  });

  test('AE5: a rollback above the remembered floor loads', async ({ page, baseURL }) => {
    const fixture = await serveFixture(page, baseURL);
    await presetFloor(page, fixture, 100);
    fixture.serve({ sequence: 300, floor: 100 });
    await page.goto(fixture.external);
    await expectHeader(page);
  });

  test('AE6: after a withdrawal raised the floor, the replayed older release is refused', async ({ page, baseURL }) => {
    const fixture = await serveFixture(page, baseURL);
    await presetFloor(page, fixture, undefined);
    fixture.serve({ sequence: 300, floor: 250 });
    await page.goto(fixture.external);
    await expectHeader(page);
    expect(await page.evaluate((key) => localStorage.getItem(key), FLOOR_KEY)).toBe('250');

    fixture.serve({ sequence: 200, floor: 0 });
    const refused = refusal(page);
    await page.reload();
    expect(await refused).toBe('below-floor');
    await expectNoHeader(page);
  });

  test("AE7: a loader tag whose integrity doesn't match the served loader loads nothing", async ({ page, baseURL }) => {
    const { src } = await environmentLoader(page.request, baseURL);
    const external = await serveExternalSite({ page, baseURL, loader: { src, integrity: sha384('not the loader') } });
    await page.goto(external);
    await expect(page.locator('html')).toHaveAttribute('data-loader', 'error');
    await expectNoHeader(page);
  });

  test("the environment's loader with its integrity from loader.json renders the header", async ({ page, baseURL }) => {
    const external = await serveExternalSite({ page, baseURL });
    await page.goto(external);
    await expect(page.locator('html')).toHaveAttribute('data-loader', 'load');
    await expectHeader(page);
  });
});
