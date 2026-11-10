import { generateKeyPair, SignJWT, UnsecuredJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthError } from './errors.js';
import { createJwtVerifier } from './jwt-verifier.js';
import { CLIENT_ID, startFakeIdp, type FakeIdp } from './test-support/fake-idp.js';
import type { AudiencePredicate, JwtVerifier } from './types.js';

let idp: FakeIdp;
let verifier: JwtVerifier;

beforeAll(async () => {
  idp = await startFakeIdp();
});
afterAll(() => idp.close());
beforeEach(() => {
  idp.failDiscovery = false;
  idp.failJwks = false;
  idp.discoveryRequests = 0;
  verifier = createJwtVerifier({ issuerUrl: idp.issuer, fetch: idp.fetch, audience: CLIENT_ID });
});

/** Resolves to the AuthError code of a rejected verify, or 'accepted'. */
async function outcome(token: string, target: JwtVerifier = verifier): Promise<string> {
  try {
    await target.verify(token);
    return 'accepted';
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    return error.code;
  }
}

describe('createJwtVerifier', () => {
  describe('verify', () => {
    it('returns the AuthUser for a valid RS256 token', async () => {
      const token = await idp.sign({ sub: 'svc-1', preferred_username: 'svc', email: 'svc@example.com' });
      const user = await verifier.verify(token);
      expect(user).toMatchObject({ issuer: idp.issuer, subject: 'svc-1', name: 'svc', username: 'svc' });
      expect(user.claims['aud']).toBe(CLIENT_ID);
      await verifier.verify(token);
      expect(idp.discoveryRequests).toBe(1);
    });
    it('accepts any of several configured audiences', async () => {
      const multi = createJwtVerifier({ issuerUrl: idp.issuer, fetch: idp.fetch, audience: ['other', 'api'] });
      await expect(multi.verify(await idp.sign({ sub: 'x' }, { audience: 'api' }))).resolves.toMatchObject({
        subject: 'x',
      });
    });
    describe('with an audience predicate', () => {
      it('accepts a token when the predicate accepts its verified claims', async () => {
        const accepts = vi.fn<AudiencePredicate>((claims) => claims['aud'] === 'linked-client');
        const byPredicate = createJwtVerifier({ issuerUrl: idp.issuer, fetch: idp.fetch, audience: accepts });
        const token = await idp.sign({ sub: 'x', azp: 'linked-client' }, { audience: 'linked-client' });
        await expect(byPredicate.verify(token)).resolves.toMatchObject({ subject: 'x' });
        expect(accepts).toHaveBeenCalledWith(expect.objectContaining({ aud: 'linked-client', azp: 'linked-client' }));
      });
      it('waits for an async predicate and rejects the token when it resolves false', async () => {
        const linked = new Set(['linked-client']);
        const byPredicate = createJwtVerifier({
          issuerUrl: idp.issuer,
          fetch: idp.fetch,
          audience: (claims) => Promise.resolve(linked.has(String(claims['aud']))),
        });
        const token = await idp.sign({ sub: 'x' }, { audience: 'linked-client' });
        await expect(byPredicate.verify(token)).resolves.toMatchObject({ subject: 'x' });
        linked.delete('linked-client');
        expect(await outcome(token, byPredicate)).toBe('invalid_token');
      });
      it('rejects with the error a throwing predicate raised, not as an invalid token', async () => {
        const outage = new Error('credential lookup failed');
        const byPredicate = createJwtVerifier({
          issuerUrl: idp.issuer,
          fetch: idp.fetch,
          audience: () => Promise.reject(outage),
        });
        await expect(byPredicate.verify(await idp.sign({ sub: 'x' }))).rejects.toBe(outage);
      });
      it('never calls the predicate for a token whose signature fails', async () => {
        const accepts = vi.fn<AudiencePredicate>(() => true);
        const byPredicate = createJwtVerifier({ issuerUrl: idp.issuer, fetch: idp.fetch, audience: accepts });
        const { privateKey } = await generateKeyPair('RS256');
        const forged = await new SignJWT({ sub: 'x', iss: idp.issuer, aud: 'linked-client' })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setExpirationTime('5m')
          .sign(privateKey);
        expect(await outcome(forged, byPredicate)).toBe('invalid_token');
        expect(accepts).not.toHaveBeenCalled();
      });
    });
    it('throws AuthError(invalid_token) for an expired token', async () => {
      const expired = await idp.sign({ sub: 'x' }, { expiresIn: Math.floor(Date.now() / 1000) - 120 });
      expect(await outcome(expired)).toBe('invalid_token');
      // Within the default 30 s tolerance it is still accepted.
      const justExpired = await idp.sign({ sub: 'x' }, { expiresIn: Math.floor(Date.now() / 1000) - 5 });
      await expect(verifier.verify(justExpired)).resolves.toMatchObject({ subject: 'x' });
      const strict = createJwtVerifier({
        issuerUrl: idp.issuer,
        fetch: idp.fetch,
        audience: CLIENT_ID,
        clockToleranceSeconds: 0,
      });
      expect(await outcome(justExpired, strict)).toBe('invalid_token');
    });
    it('throws AuthError(invalid_token) for a not-yet-valid token', async () => {
      expect(await outcome(await idp.sign({ sub: 'x', nbf: Math.floor(Date.now() / 1000) + 300 }))).toBe(
        'invalid_token',
      );
    });
    it('throws AuthError(invalid_token) for a wrong issuer or audience', async () => {
      expect(await outcome(await idp.sign({ sub: 'x' }, { issuer: 'https://evil.example' }))).toBe('invalid_token');
      expect(await outcome(await idp.sign({ sub: 'x' }, { audience: 'another-client' }))).toBe('invalid_token');
    });
    it('throws AuthError(invalid_token) for a token signed by an unknown key', async () => {
      const { privateKey } = await generateKeyPair('RS256');
      const forged = await new SignJWT({ sub: 'x', iss: idp.issuer, aud: CLIENT_ID })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setExpirationTime('5m')
        .sign(privateKey);
      expect(await outcome(forged)).toBe('invalid_token');
      // A key id the reachable JWKS does not have.
      const unknownKid = await new SignJWT({ sub: 'x', iss: idp.issuer, aud: CLIENT_ID })
        .setProtectedHeader({ alg: 'RS256', kid: 'k-unknown' })
        .setExpirationTime('5m')
        .sign(privateKey);
      expect(await outcome(unknownKid)).toBe('invalid_token');
      expect(await outcome('not-a-jwt')).toBe('invalid_token');
    });
    it('rejects alg none and HS256 tokens', async () => {
      const unsecured = new UnsecuredJWT({ sub: 'x' }).setIssuer(idp.issuer).setAudience(CLIENT_ID).encode();
      expect(await outcome(unsecured)).toBe('invalid_token');
      const hs256 = await new SignJWT({ sub: 'x', iss: idp.issuer, aud: CLIENT_ID })
        .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode('a-shared-secret-that-is-long-enough!!'));
      expect(await outcome(hs256)).toBe('invalid_token');
    });
    it('throws AuthError(verifier_unavailable) when discovery fails, and retries discovery', async () => {
      const token = await idp.sign({ sub: 'x' });
      idp.failDiscovery = true;
      expect(await outcome(token)).toBe('verifier_unavailable');
      idp.failDiscovery = false;
      await expect(verifier.verify(token)).resolves.toMatchObject({ subject: 'x' });
      expect(idp.discoveryRequests).toBe(2);
    });
    it('throws AuthError(verifier_unavailable) when the JWKS endpoint errors, and retries it', async () => {
      const token = await idp.sign({ sub: 'x' });
      idp.failJwks = true;
      // The client-facing message says nothing about the cause.
      await expect(verifier.verify(token)).rejects.toMatchObject({
        code: 'verifier_unavailable',
        message: 'Token verification is unavailable',
      });
      idp.failJwks = false;
      await expect(verifier.verify(token)).resolves.toMatchObject({ subject: 'x' });
    });
    it.each([
      ['unreachable', new TypeError('fetch failed')],
      // What fetch rejects with when jose's request timeout aborts it.
      ['timing out', new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
    ])('throws AuthError(verifier_unavailable) when the JWKS endpoint is %s', async (_, failure) => {
      const unreachable = createJwtVerifier({
        issuerUrl: idp.issuer,
        audience: CLIENT_ID,
        fetch: (url, init) => (new URL(url).pathname === '/jwks' ? Promise.reject(failure) : idp.fetch(url, init)),
      });
      expect(await outcome(await idp.sign({ sub: 'x' }), unreachable)).toBe('verifier_unavailable');
    });
  });
});
