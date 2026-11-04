import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';

import { PrincipalResolver } from './principal.resolver.js';

/**
 * Recipient endpoints (R10, R11): a person's own token relayed by a configured relaying app. Service-account tokens
 * never get here, so they never create a recipient.
 */
@Injectable()
export class RecipientGuard implements CanActivate {
  private readonly principals: PrincipalResolver;

  constructor(@Inject(PrincipalResolver) principals: PrincipalResolver) {
    this.principals = principals;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.principals.require(context, 'relaying-user');
    return true;
  }
}
