import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { LinkedCredential } from './directories.js';
import type { PrincipalRequest } from './principal.resolver.js';
import type { Principal } from './token-kind.js';

function requestPrincipal(context: ExecutionContext): Principal {
  const { principal } = context.switchToHttp().getRequest<PrincipalRequest>();
  if (!principal) throw new Error('CurrentPrincipal used on a route without an auth guard');
  return principal;
}

/**
 * Injects the principal a credential, admin, owner or recipient guard attached. Throws on a route without one of
 * those guards, which is a programming error.
 */
export const CurrentPrincipal: () => ParameterDecorator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => requestPrincipal(context),
);

/**
 * Injects the linked credential the CredentialGuard attached. Throws on a route whose principal is not a credential,
 * which is a programming error.
 */
export const CurrentCredential: () => ParameterDecorator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): LinkedCredential => {
    const principal = requestPrincipal(context);
    if (principal.kind !== 'credential') throw new Error('CurrentCredential used on a route without a credential');
    return principal.credential;
  },
);
