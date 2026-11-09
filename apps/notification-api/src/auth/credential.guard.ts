import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';

import { PrincipalResolver } from './principal.resolver.js';

/**
 * Credential endpoints (R8): a client-credentials token whose `azp` is a linked credential. The principal carries the
 * credential's sender and scoped types.
 */
@Injectable()
export class CredentialGuard implements CanActivate {
  private readonly principals: PrincipalResolver;

  constructor(@Inject(PrincipalResolver) principals: PrincipalResolver) {
    this.principals = principals;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.principals.require(context, 'credential');
    return true;
  }
}
