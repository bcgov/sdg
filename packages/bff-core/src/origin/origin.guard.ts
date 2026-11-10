import { ForbiddenException, Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { BFF_OPTIONS, type BffModuleOptions } from '../nestjs/bff.options.js';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/**
 * Refuses cross-site writes (R31, CWE-352): every request other than GET or HEAD, auth routes included, must carry an
 * `Origin` equal to the BFF's own origin (from APP_URL), or it gets 403 before any handler runs, so core-api is never
 * contacted. A same-site page can send a form POST with the SameSite=lax cookie, and only Origin tells it apart;
 * browsers send Origin on every non-GET request, so a missing one is refused too. BffModule registers it globally.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly origin: string;

  constructor(@Inject(BFF_OPTIONS) options: BffModuleOptions) {
    this.origin = new URL(options.appUrl).origin;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
    if (req.get('origin') !== this.origin) throw new ForbiddenException('Cross-origin request refused');
    return true;
  }
}
