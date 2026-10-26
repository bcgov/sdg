import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import type { JwtVerifier } from '../types.js';
import type { AuthRequest } from './request.js';
import { JWT_VERIFIER } from './tokens.js';

const BEARER = /^Bearer ([A-Za-z0-9\-_.~+/]+=*)$/;

function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  return BEARER.exec(header)?.[1] ?? null;
}

/** Accepts `Authorization: Bearer <jwt>` only; sets `request.user` or responds 401. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger: Logger = new Logger(JwtAuthGuard.name);
  private readonly verifier: JwtVerifier;

  constructor(@Inject(JWT_VERIFIER) verifier: JwtVerifier) {
    this.verifier = verifier;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = bearerToken(request.headers['authorization']);
    if (token === null) {
      this.logger.debug('Rejected request: missing or malformed Authorization header');
      throw new UnauthorizedException();
    }
    try {
      request.user = await this.verifier.verify(token);
      return true;
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : 'unknown';
      this.logger.debug(`Rejected bearer token: ${cause}`);
      throw new UnauthorizedException();
    }
  }
}
