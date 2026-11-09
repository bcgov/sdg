import { ForbiddenException, Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';

import { SENDER_OWNERSHIP, type SenderOwnership } from './directories.js';
import { PrincipalResolver, type PrincipalRequest } from './principal.resolver.js';

/**
 * Sender-owner endpoints (R7, R10): a person's token issued to notification-api's own client, from an owner of the
 * path's `:senderId` or an admin (who passes for any sender).
 */
@Injectable()
export class OwnerGuard implements CanActivate {
  private readonly principals: PrincipalResolver;
  private readonly ownership: SenderOwnership;

  constructor(
    @Inject(PrincipalResolver) principals: PrincipalResolver,
    @Inject(SENDER_OWNERSHIP) ownership: SenderOwnership,
  ) {
    this.principals = principals;
    this.ownership = ownership;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const principal = await this.principals.require(context, 'own-client-user');
    if (principal.isAdmin) return true;
    const senderId = context.switchToHttp().getRequest<PrincipalRequest>().params?.['senderId'];
    if (senderId === undefined) throw new Error('OwnerGuard is on a route without a :senderId parameter');
    if (!(await this.ownership.isOwner(senderId, principal))) throw new ForbiddenException();
    return true;
  }
}
