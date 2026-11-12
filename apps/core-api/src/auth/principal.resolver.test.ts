import { Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AuthError, claimsToAuthUser, type AuthUser, type JwtVerifier } from '@repo/auth';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { CallerRequest, KeycloakClients } from './caller.js';
import { acceptedClaims, callerKind, PrincipalResolver } from './principal.resolver.js';

const CLIENTS: KeycloakClients = { portal: 'sdg-portal', console: 'sdg-console' };
const ISS = 'https://idp.test';

const portalClaims = { iss: ISS, sub: 'resident-1', azp: 'sdg-portal', preferred_username: 'abc@bcsc' };
const consoleClaims = (roles: string[]) => ({ iss: ISS, sub: 'idir-1', azp: 'sdg-console', client_roles: roles });
const serviceClaims = {
  iss: ISS,
  sub: 'svc-1',
  azp: 'partner-client',
  client_id: 'partner-client',
  preferred_username: 'service-account-partner-client',
};

function verifierReturning(claims: Record<string, unknown>): JwtVerifier & { verify: ReturnType<typeof vi.fn> } {
  return { verify: vi.fn<(token: string) => Promise<AuthUser>>().mockResolvedValue(claimsToAuthUser(claims)) };
}

function verifierFailing(error: unknown): JwtVerifier {
  return { verify: vi.fn<(token: string) => Promise<AuthUser>>().mockRejectedValue(error) };
}

const request = (authorization?: string): CallerRequest => ({ headers: { authorization } });

describe('callerKind', () => {
  it('Should classify a portal-client person token as a portal user', () => {
    expect(callerKind(portalClaims, CLIENTS)).toBe('portal-user');
  });

  it('Should classify a console-client person token as a console user', () => {
    expect(callerKind(consoleClaims([]), CLIENTS)).toBe('console-user');
  });

  it('Should classify client-credentials tokens as service accounts, even from the portal client', () => {
    expect(callerKind(serviceClaims, CLIENTS)).toBe('service-account');
    expect(callerKind({ iss: ISS, sub: 's', azp: 'sdg-portal', client_id: 'sdg-portal' }, CLIENTS)).toBe(
      'service-account',
    );
    expect(callerKind({ iss: ISS, sub: 's', azp: 'x', preferred_username: 'service-account-x' }, CLIENTS)).toBe(
      'service-account',
    );
  });

  it('Should not classify a person token from any other client', () => {
    expect(callerKind({ ...portalClaims, azp: 'someone-else' }, CLIENTS)).toBeUndefined();
    expect(callerKind({ ...portalClaims, azp: undefined }, CLIENTS)).toBeUndefined();
  });

  it('Should accept no console-client token while CONSOLE_CLIENT_ID is unset', () => {
    expect(callerKind(consoleClaims(['admin']), { portal: 'sdg-portal', console: undefined })).toBeUndefined();
  });
});

describe('acceptedClaims (the verifier audience predicate)', () => {
  const accepts = acceptedClaims(CLIENTS);

  it('Should accept portal, console and service-account tokens without any lookup', () => {
    expect(accepts(portalClaims)).toBe(true);
    expect(accepts(consoleClaims([]))).toBe(true);
    expect(accepts(serviceClaims)).toBe(true);
  });

  it('Should reject a person token from an unknown client', () => {
    expect(accepts({ ...portalClaims, azp: 'unknown' })).toBe(false);
  });
});

describe('PrincipalResolver', () => {
  let warnSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('Should resolve a portal user and keep the token for the userinfo call', async () => {
    const resolver = new PrincipalResolver(verifierReturning(portalClaims), CLIENTS);
    const caller = await resolver.resolve(request('Bearer a.b.c'));
    expect(caller).toMatchObject({ kind: 'portal-user', token: 'a.b.c', user: { subject: 'resident-1' } });
  });

  it('Should read the admin role from client_roles', async () => {
    const withRole = await new PrincipalResolver(verifierReturning(consoleClaims(['admin'])), CLIENTS).resolve(
      request('Bearer t'),
    );
    const withoutRole = await new PrincipalResolver(verifierReturning(consoleClaims(['viewer'])), CLIENTS).resolve(
      request('Bearer t'),
    );
    expect(withRole).toMatchObject({ kind: 'console-user', isAdmin: true });
    expect(withoutRole).toMatchObject({ kind: 'console-user', isAdmin: false });
  });

  it('Should name a service account by its client id', async () => {
    const caller = await new PrincipalResolver(verifierReturning(serviceClaims), CLIENTS).resolve(request('Bearer t'));
    expect(caller).toMatchObject({ kind: 'service-account', clientId: 'partner-client' });
  });

  it('Should verify once per request', async () => {
    const verifier = verifierReturning(portalClaims);
    const resolver = new PrincipalResolver(verifier, CLIENTS);
    const req = request('Bearer t');
    await resolver.resolve(req);
    await resolver.resolve(req);
    expect(verifier.verify).toHaveBeenCalledTimes(1);
  });

  it('Should answer 401 to a missing or non-Bearer Authorization header without verifying', async () => {
    const verifier = verifierReturning(portalClaims);
    const resolver = new PrincipalResolver(verifier, CLIENTS);
    await expect(resolver.resolve(request())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(resolver.resolve(request('Basic dXNlcjpwYXNz'))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('Should answer 401 to an invalid token', async () => {
    const resolver = new PrincipalResolver(verifierFailing(new AuthError('invalid_token')), CLIENTS);
    await expect(resolver.resolve(request('Bearer t'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('Should answer 503 when the signing keys cannot be fetched (R10)', async () => {
    const resolver = new PrincipalResolver(verifierFailing(new AuthError('verifier_unavailable')), CLIENTS);
    await expect(resolver.resolve(request('Bearer t'))).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ msg: 'Keycloak signing keys are unavailable' }));
  });

  it('Should rethrow an unexpected verifier error unchanged', async () => {
    const boom = new TypeError('boom');
    const resolver = new PrincipalResolver(verifierFailing(boom), CLIENTS);
    await expect(resolver.resolve(request('Bearer t'))).rejects.toBe(boom);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'Token verification failed unexpectedly',
        error: expect.objectContaining({ message: 'boom' }),
      }),
    );
  });
});
