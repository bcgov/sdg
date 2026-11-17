import {
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { AuthError, claimsToAuthUser, type AuthUser, type JwtVerifier } from '@repo/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConsoleGuard,
  InternalGuard,
  OptionalSharedGuard,
  PortalGuard,
  SharedGuard,
  type AudienceGuard,
} from './audience.guards.js';
import type { Caller, CallerRequest } from './caller.js';
import { optionalCaller } from './optional-caller.decorator.js';
import { PrincipalResolver } from './principal.resolver.js';

const user = claimsToAuthUser({ iss: 'https://idp.test', sub: 'someone' });
const callers = {
  portal: { kind: 'portal-user', user, token: 't' },
  admin: { kind: 'console-user', user, token: 't', isAdmin: true },
  consoleWithoutRole: { kind: 'console-user', user, token: 't', isAdmin: false },
  service: { kind: 'service-account', user, token: 't', clientId: 'partner' },
} satisfies Record<string, Caller>;

/** A resolver that already verified the token as `caller`. */
function resolverFor(caller: Caller): PrincipalResolver {
  const resolver: Pick<PrincipalResolver, 'resolve'> = {
    resolve: (request: CallerRequest) => {
      request.caller = caller;
      return Promise.resolve(caller);
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the guards only call resolve().
  return resolver as PrincipalResolver;
}

function context(request: CallerRequest): ExecutionContext {
  const http = { getRequest: () => request };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the guards only read the HTTP request.
  return { switchToHttp: () => http } as unknown as ExecutionContext;
}

type GuardClass = new (resolver: PrincipalResolver) => AudienceGuard;

async function verdict(Guard: GuardClass, caller: Caller): Promise<'allowed' | 'forbidden'> {
  try {
    await new Guard(resolverFor(caller)).canActivate(context({ headers: {} }));
    return 'allowed';
  } catch (error) {
    if (error instanceof ForbiddenException) return 'forbidden';
    throw error;
  }
}

describe('Audience guards (R9)', () => {
  it.each([
    [
      'PortalGuard',
      PortalGuard,
      { portal: 'allowed', admin: 'forbidden', consoleWithoutRole: 'forbidden', service: 'forbidden' },
    ],
    [
      'ConsoleGuard',
      ConsoleGuard,
      { portal: 'forbidden', admin: 'allowed', consoleWithoutRole: 'forbidden', service: 'forbidden' },
    ],
    [
      'SharedGuard',
      SharedGuard,
      { portal: 'allowed', admin: 'allowed', consoleWithoutRole: 'allowed', service: 'forbidden' },
    ],
    [
      'InternalGuard',
      InternalGuard,
      { portal: 'allowed', admin: 'allowed', consoleWithoutRole: 'allowed', service: 'forbidden' },
    ],
  ] as const)('%s admits only its audience', async (_name, Guard, expected) => {
    const actual = {
      portal: await verdict(Guard, callers.portal),
      admin: await verdict(Guard, callers.admin),
      consoleWithoutRole: await verdict(Guard, callers.consoleWithoutRole),
      service: await verdict(Guard, callers.service),
    };
    expect(actual).toEqual(expected);
  });

  it('Should leave the resolved caller on the request for the handler', async () => {
    const request: CallerRequest = { headers: {} };
    await new PortalGuard(resolverFor(callers.portal)).canActivate(context(request));
    expect(request.caller).toBe(callers.portal);
  });
});

const CLIENTS = { portal: 'sdg-portal', console: 'sdg-console' };
const ISS = 'https://idp.test';

/** A real resolver over a verifier that returns `claims`, or rejects with `error`. */
function guardVerifying(outcome: { claims: Record<string, unknown> } | { error: unknown }): {
  guard: OptionalSharedGuard;
  verify: ReturnType<typeof vi.fn>;
} {
  const verify = vi.fn<(token: string) => Promise<AuthUser>>();
  if ('claims' in outcome) verify.mockResolvedValue(claimsToAuthUser(outcome.claims));
  else verify.mockRejectedValue(outcome.error);
  const verifier: JwtVerifier = { verify };
  return { guard: new OptionalSharedGuard(new PrincipalResolver(verifier, CLIENTS)), verify };
}

const withAuthorization = (authorization: string): CallerRequest => ({ headers: { authorization } });

describe('OptionalSharedGuard (KTD3, R5, R12)', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('Should admit a request without an Authorization header as anonymous, without verifying', async () => {
    const { guard, verify } = guardVerifying({ claims: { iss: ISS, sub: 'resident-1', azp: 'sdg-portal' } });
    const request: CallerRequest = { headers: {} };
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
    expect(optionalCaller(context(request))).toBeUndefined();
  });

  it('Should admit a valid portal token with a portal-user caller', async () => {
    const { guard } = guardVerifying({ claims: { iss: ISS, sub: 'resident-1', azp: 'sdg-portal' } });
    const request = withAuthorization('Bearer a.b.c');
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(optionalCaller(context(request))).toMatchObject({
      kind: 'portal-user',
      token: 'a.b.c',
      user: { subject: 'resident-1' },
    });
  });

  it('Should admit a valid console token with a console-user caller, admin role or not', async () => {
    const { guard } = guardVerifying({ claims: { iss: ISS, sub: 'idir-1', azp: 'sdg-console', client_roles: [] } });
    const request = withAuthorization('Bearer a.b.c');
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(optionalCaller(context(request))).toMatchObject({ kind: 'console-user', isAdmin: false });
  });

  it('Should answer 403 to a service-account token', async () => {
    const { guard } = guardVerifying({
      claims: { iss: ISS, sub: 'svc-1', azp: 'partner-client', client_id: 'partner-client' },
    });
    await expect(guard.canActivate(context(withAuthorization('Bearer a.b.c')))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('Should answer 401 to a non-Bearer Authorization header', async () => {
    const { guard, verify } = guardVerifying({ claims: { iss: ISS, sub: 'resident-1', azp: 'sdg-portal' } });
    await expect(guard.canActivate(context(withAuthorization('Basic dXNlcjpwYXNz')))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it('Should answer 401 to an invalid token', async () => {
    const { guard } = guardVerifying({ error: new AuthError('invalid_token') });
    await expect(guard.canActivate(context(withAuthorization('Bearer a.b.c')))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('Should answer 503 when the signing keys cannot be fetched', async () => {
    const { guard } = guardVerifying({ error: new AuthError('verifier_unavailable') });
    await expect(guard.canActivate(context(withAuthorization('Bearer a.b.c')))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
