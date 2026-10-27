import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthError } from './errors.js';
import { createOidcClient } from './oidc-client.js';
import { CLIENT_ID, CLIENT_SECRET, startFakeIdp, type FakeIdp } from './test-support/fake-idp.js';
import type { OidcClient, OidcClientOptions } from './types.js';

const REDIRECT_URI = 'http://app.test/api/auth/callback';
const POST_LOGOUT_URI = 'http://app.test/';

let idp: FakeIdp;

beforeAll(async () => {
  idp = await startFakeIdp();
});
afterAll(() => idp.close());
beforeEach(() => {
  idp.discoveryRequests = 0;
  idp.failDiscovery = false;
});

function newClient(overrides: Partial<OidcClientOptions> = {}): OidcClient {
  return createOidcClient({
    issuerUrl: idp.issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    postLogoutRedirectUri: POST_LOGOUT_URI,
    fetch: idp.fetch,
    ...overrides,
  });
}

async function rejection(promise: Promise<unknown>): Promise<AuthError> {
  const error = await promise.then(
    () => expect.fail('expected a rejection'),
    (reason: unknown) => reason,
  );
  if (!(error instanceof AuthError)) throw new Error('expected an AuthError', { cause: error });
  return error;
}

/** Starts a login and returns a callback URL for a code the fake IdP will redeem. */
async function login(client: OidcClient, claims: Record<string, unknown> = {}, nonce?: string) {
  const { url, pending } = await client.createAuthorizationRequest('/after');
  const codeChallenge = url.searchParams.get('code_challenge') ?? '';
  const code = idp.issueCode({ nonce: nonce ?? pending.nonce, codeChallenge, claims: { sub: 'user-1', ...claims } });
  const callbackUrl = new URL(`${REDIRECT_URI}?code=${code}&state=${pending.state}`);
  return { pending, callbackUrl };
}

describe('createOidcClient', () => {
  describe('discovery', () => {
    it('is lazy and cached after success', async () => {
      const client = newClient();
      expect(idp.discoveryRequests).toBe(0);
      await client.discover();
      await client.discover();
      await client.createAuthorizationRequest('/');
      await client.buildEndSessionUrl(null);
      expect(idp.discoveryRequests).toBe(1);
    });
    it('retries after a failure and throws AuthError(discovery_failed)', async () => {
      const client = newClient();
      idp.failDiscovery = true;
      expect((await rejection(client.discover())).code).toBe('discovery_failed');
      expect((await rejection(client.createAuthorizationRequest('/'))).code).toBe('discovery_failed');
      expect(idp.discoveryRequests).toBe(2);
      idp.failDiscovery = false;
      await expect(client.discover()).resolves.toBeUndefined();
      expect(idp.discoveryRequests).toBe(3);
    });
    it('refuses plain http issuers', async () => {
      const error = await rejection(newClient({ issuerUrl: idp.issuer.replace('https:', 'http:') }).discover());
      expect(error.code).toBe('discovery_failed');
      expect(error.cause).toBeDefined();
      expect(idp.discoveryRequests).toBe(0);
    });
  });
  describe('createAuthorizationRequest', () => {
    it('builds an authorize URL with S256 PKCE, state, nonce, scopes and redirect_uri', async () => {
      const { url, pending } = await newClient().createAuthorizationRequest('/after');
      expect(`${url.origin}${url.pathname}`).toBe(`${idp.issuer}/auth`);
      const params = Object.fromEntries(url.searchParams);
      expect(params).toMatchObject({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: 'openid profile email',
        state: pending.state,
        nonce: pending.nonce,
        code_challenge_method: 'S256',
      });
      expect(params['code_challenge']).toMatch(/^[\w-]{43}$/);
      expect(params['code_challenge']).not.toBe(pending.codeVerifier);
      expect(url.searchParams.has('client_secret')).toBe(false);
      expect(pending.returnTo).toBe('/after');

      const custom = await newClient({ scopes: ['openid', 'roles'] }).createAuthorizationRequest('/');
      expect(custom.url.searchParams.get('scope')).toBe('openid roles');
    });
    it('returns a fresh state, nonce and code verifier each call', async () => {
      const client = newClient();
      const first = (await client.createAuthorizationRequest('/')).pending;
      const second = (await client.createAuthorizationRequest('/')).pending;
      expect(second.state).not.toBe(first.state);
      expect(second.nonce).not.toBe(first.nonce);
      expect(second.codeVerifier).not.toBe(first.codeVerifier);
      expect(first.codeVerifier.length).toBeGreaterThanOrEqual(43);
    });
  });
  describe('handleCallback', () => {
    it('returns the AuthUser and tokens for a valid code', async () => {
      const client = newClient();
      const { pending, callbackUrl } = await login(client, { name: 'Ada Lovelace', email: 'ada@example.com' });
      const before = Date.now();
      const { user, tokens } = await client.handleCallback(callbackUrl, pending);
      expect(user).toMatchObject({
        issuer: idp.issuer,
        subject: 'user-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
      });
      expect(user.claims['nonce']).toBe(pending.nonce);
      expect(tokens).toMatchObject({ accessToken: 'access-token', refreshToken: 'refresh-token' });
      expect(tokens.idToken.split('.')).toHaveLength(3);
      expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 299_000);
    });
    it('throws AuthError(invalid_state) on a missing or mismatched state', async () => {
      const client = newClient();
      const { pending, callbackUrl } = await login(client);
      const missing = new URL(callbackUrl);
      missing.searchParams.delete('state');
      expect((await rejection(client.handleCallback(missing, pending))).code).toBe('invalid_state');
      const forged = new URL(callbackUrl);
      forged.searchParams.set('state', 'forged');
      expect((await rejection(client.handleCallback(forged, pending))).code).toBe('invalid_state');
      expect((await rejection(client.handleCallback(callbackUrl, { ...pending, state: '' }))).code).toBe(
        'invalid_state',
      );
    });
    it('throws AuthError(callback_failed) with detail for an IdP error parameter', async () => {
      const client = newClient();
      const { pending } = await client.createAuthorizationRequest('/');
      const url = new URL(`${REDIRECT_URI}?error=access_denied&error_description=nope&state=${pending.state}`);
      const error = await rejection(client.handleCallback(url, pending));
      expect(error.code).toBe('callback_failed');
      expect(error.detail).toBe('access_denied');
      expect(error.message).not.toContain('nope');
    });
    it('throws AuthError(callback_failed) for a nonce mismatch', async () => {
      const client = newClient();
      const { pending, callbackUrl } = await login(client, {}, 'other-nonce');
      const error = await rejection(client.handleCallback(callbackUrl, pending));
      expect(error.code).toBe('callback_failed');
      expect(error.cause).toBeDefined();
    });
    it('throws AuthError(callback_failed) for a wrong audience or a failed code exchange', async () => {
      const client = newClient();
      const wrongAud = await login(client, { aud: 'someone-else' });
      expect((await rejection(client.handleCallback(wrongAud.callbackUrl, wrongAud.pending))).code).toBe(
        'callback_failed',
      );
      const badVerifier = await login(client);
      const pending = { ...badVerifier.pending, codeVerifier: 'x'.repeat(43) };
      expect((await rejection(client.handleCallback(badVerifier.callbackUrl, pending))).code).toBe('callback_failed');
    });
  });
  describe('buildEndSessionUrl', () => {
    it('includes client_id, post_logout_redirect_uri and id_token_hint', async () => {
      const client = newClient();
      const url = await client.buildEndSessionUrl('id.token.value');
      expect(`${url.origin}${url.pathname}`).toBe(`${idp.issuer}/logout`);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        client_id: CLIENT_ID,
        post_logout_redirect_uri: POST_LOGOUT_URI,
        id_token_hint: 'id.token.value',
      });
      expect((await client.buildEndSessionUrl(null)).searchParams.has('id_token_hint')).toBe(false);
    });
  });
});
