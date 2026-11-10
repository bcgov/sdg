import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { claimsToAuthUser } from '@repo/auth';
import { describe, expect, it } from 'vitest';

import { AdminGuard, InternalGuard, PortalGuard, SharedGuard, type AudienceGuard } from './audience.guards.js';
import type { Caller, CallerRequest } from './caller.js';
import type { PrincipalResolver } from './principal.resolver.js';

const user = claimsToAuthUser({ iss: 'https://idp.test', sub: 'someone' });
const callers = {
  portal: { kind: 'portal-user', user, token: 't' },
  admin: { kind: 'admin-user', user, token: 't', isAdmin: true },
  adminWithoutRole: { kind: 'admin-user', user, token: 't', isAdmin: false },
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
      { portal: 'allowed', admin: 'forbidden', adminWithoutRole: 'forbidden', service: 'forbidden' },
    ],
    [
      'AdminGuard',
      AdminGuard,
      { portal: 'forbidden', admin: 'allowed', adminWithoutRole: 'forbidden', service: 'forbidden' },
    ],
    [
      'SharedGuard',
      SharedGuard,
      { portal: 'allowed', admin: 'allowed', adminWithoutRole: 'allowed', service: 'forbidden' },
    ],
    [
      'InternalGuard',
      InternalGuard,
      { portal: 'allowed', admin: 'allowed', adminWithoutRole: 'allowed', service: 'forbidden' },
    ],
  ] as const)('%s admits only its audience', async (_name, Guard, expected) => {
    const actual = {
      portal: await verdict(Guard, callers.portal),
      admin: await verdict(Guard, callers.admin),
      adminWithoutRole: await verdict(Guard, callers.adminWithoutRole),
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
