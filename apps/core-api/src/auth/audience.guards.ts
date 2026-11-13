import { ForbiddenException, Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';

import type { Caller, CallerRequest } from './caller.js';
import { PrincipalResolver } from './principal.resolver.js';

/**
 * Authorizes by audience after `PrincipalResolver` verified the token: 401/503 come from the resolver, 403 from
 * here when the caller is not of this guard's audience. The caller stays on the request (`@CurrentCaller()`).
 */
export abstract class AudienceGuard implements CanActivate {
  private readonly resolver: PrincipalResolver;

  constructor(resolver: PrincipalResolver) {
    this.resolver = resolver;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const caller = await this.resolver.resolve(context.switchToHttp().getRequest<CallerRequest>());
    if (!this.admits(caller)) throw new ForbiddenException();
    return true;
  }

  protected abstract admits(caller: Caller): boolean;
}

/** `/api/v<N>/portal/*`: portal-client person tokens. */
@Injectable()
export class PortalGuard extends AudienceGuard {
  constructor(@Inject(PrincipalResolver) resolver: PrincipalResolver) {
    super(resolver);
  }

  protected admits(caller: Caller): boolean {
    return caller.kind === 'portal-user';
  }
}

/** `/api/v<N>/console/*`: console-client person tokens carrying the admin client role. */
@Injectable()
export class ConsoleGuard extends AudienceGuard {
  constructor(@Inject(PrincipalResolver) resolver: PrincipalResolver) {
    super(resolver);
  }

  protected admits(caller: Caller): boolean {
    return caller.kind === 'console-user' && caller.isAdmin;
  }
}

/** `/api/v<N>/shared/*`: person tokens from the portal or the console client. */
@Injectable()
export class SharedGuard extends AudienceGuard {
  constructor(@Inject(PrincipalResolver) resolver: PrincipalResolver) {
    super(resolver);
  }

  protected admits(caller: Caller): boolean {
    return caller.kind === 'portal-user' || caller.kind === 'console-user';
  }
}

/**
 * `/internal/*`, the BFF-only routes: person tokens from the portal or the console client. The admin role is
 * checked by the handler that needs it (the login upsert), so its refusal is a 403 from that route.
 */
@Injectable()
export class InternalGuard extends AudienceGuard {
  constructor(@Inject(PrincipalResolver) resolver: PrincipalResolver) {
    super(resolver);
  }

  protected admits(caller: Caller): boolean {
    return caller.kind === 'portal-user' || caller.kind === 'console-user';
  }
}

/**
 * Routes open to anonymous and person callers (the portal's flag list and hello-world): a request without an
 * `Authorization` header is admitted without a caller (`@OptionalCaller()` yields undefined). Any header is resolved
 * as `SharedGuard` does, so a malformed or invalid token is still 401, an outage 503 and a service account 403.
 */
@Injectable()
export class OptionalSharedGuard extends SharedGuard {
  constructor(@Inject(PrincipalResolver) resolver: PrincipalResolver) {
    super(resolver);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CallerRequest>();
    if (request.headers['authorization'] === undefined) return true;
    return super.canActivate(context);
  }
}
