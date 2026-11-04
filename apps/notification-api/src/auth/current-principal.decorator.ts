import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { PrincipalRequest } from './principal.resolver.js';
import type { Principal } from './token-kind.js';

/**
 * Injects the principal a credential, admin, owner or recipient guard attached. Throws on a route without one of
 * those guards, which is a programming error.
 */
export const CurrentPrincipal: () => ParameterDecorator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const { principal } = context.switchToHttp().getRequest<PrincipalRequest>();
    if (!principal) throw new Error('CurrentPrincipal used on a route without an auth guard');
    return principal;
  },
);
