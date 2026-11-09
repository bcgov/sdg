import { generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { HttpFetch } from '../health/indicators.js';
import { createTestApp, requestUrl, type TestApp } from '../testing/app.js';
import { bearer } from '../testing/senders.js';
import { RELAYING_CLIENT_ID, startTestIssuer, type TestIssuer } from '../testing/tokens.js';

let t: TestApp;
let issuer: TestIssuer;
/** While true, the issuer's JWKS requests fail as if Keycloak were unreachable. */
let jwksDown = true;

beforeAll(async () => {
  issuer = await startTestIssuer();
  const issuerFetch: HttpFetch = (input, init) =>
    jwksDown && new URL(requestUrl(input)).pathname === '/jwks'
      ? Promise.reject(new TypeError('fetch failed'))
      : issuer.fetch(input, init);
  t = await createTestApp({ env: issuer.env, issuerFetch });
});

afterAll(async () => {
  await t.close();
  await issuer.close();
});

const me = (authorization: { authorization: string }) => t.http().get('/api/v1/me').set(authorization);

describe('a recipient endpoint when the issuer cannot be reached', () => {
  it('answers 503, not 401, for a valid token while the JWKS cannot be fetched, and 200 once it can', async () => {
    const token = bearer(await issuer.relayingUserToken({ subject: 'citizen-outage' }));
    const unavailable = await me(token);
    expect(unavailable.status).toBe(503);
    expect(JSON.stringify(unavailable.body)).not.toMatch(/fetch failed|jwks/i);

    jwksDown = false;
    expect((await me(token)).status).toBe(200);
  });

  it('still answers 401 for a token the issuer did not sign', async () => {
    jwksDown = false;
    const { privateKey } = await generateKeyPair('RS256');
    const forged = await new SignJWT({ sub: 'x', azp: RELAYING_CLIENT_ID, iss: issuer.issuer, aud: RELAYING_CLIENT_ID })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setExpirationTime('5m')
      .sign(privateKey);
    expect((await me(bearer(forged))).status).toBe(401);
  });
});
