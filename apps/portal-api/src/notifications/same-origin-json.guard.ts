import {
  ForbiddenException,
  Injectable,
  UnsupportedMediaTypeException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/** True when the request carries a body or declares a content type. */
function hasContent(req: Request): boolean {
  if (req.get('content-type') !== undefined || req.get('transfer-encoding') !== undefined) return true;
  const length = Number(req.get('content-length') ?? '0');
  return Number.isNaN(length) || length > 0;
}

function isJson(req: Request): boolean {
  const type = req.get('content-type');
  return type?.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

/**
 * Blocks cross-site writes through the relay (CWE-352). A same-site page can POST an HTML form with the session
 * cookie (SameSite=lax) and no CORS preflight, so on every method but GET/HEAD:
 * - 403 when the browser says the request came from another origin (`Sec-Fetch-Site` other than `same-origin`);
 * - 415 when it has a body that is not `application/json`, which forms can't send and which cross-origin `fetch` can
 *   only send after a preflight portal-api never approves. Body-less calls (DELETE, resend) pass.
 * portal-web always calls with same-origin `fetch` and JSON. Runs before the body is validated or relayed.
 */
@Injectable()
export class SameOriginJsonGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    const site = req.get('sec-fetch-site');
    if (site !== undefined && site !== 'same-origin') throw new ForbiddenException();
    if (hasContent(req) && !isJson(req)) throw new UnsupportedMediaTypeException('Send application/json');
    return true;
  }
}
