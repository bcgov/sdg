import { ForbiddenException, Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';

import { PrincipalResolver } from './principal.resolver.js';

/** Admin endpoints (R10): a person's token issued to notification-api's own client, with the admin client role. */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly principals: PrincipalResolver;

  constructor(@Inject(PrincipalResolver) principals: PrincipalResolver) {
    this.principals = principals;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const principal = await this.principals.require(context, 'own-client-user');
    if (!principal.isAdmin) throw new ForbiddenException();
    return true;
  }
}
