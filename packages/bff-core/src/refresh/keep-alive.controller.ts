import {
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { BFF_OPTIONS, SESSION_SECURITY_SCHEME, type BffModuleOptions } from '../nestjs/bff.options.js';
import { TokenRefreshService } from './token-refresh.service.js';

export interface KeepAliveResponse {
  idleExpiresAt: number | null;
}

export const keepAliveResponseSchema: z.ZodType<KeepAliveResponse> = z.object({
  idleExpiresAt: z.number().int().nullable().meta({
    description:
      'When the session ends unless renewed, as epoch milliseconds (Keycloak refresh-token expiry); null when unknown',
  }),
});

/**
 * The web app's keep-alive while the user is active: renews the session's tokens so Keycloak's idle limit restarts,
 * and says when it will lapse next. A POST because it changes the session, so the origin guard applies.
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: VERSION_NEUTRAL })
export class KeepAliveController {
  private readonly refresh: TokenRefreshService;
  private readonly options: BffModuleOptions;

  constructor(
    @Inject(TokenRefreshService) refresh: TokenRefreshService,
    @Inject(BFF_OPTIONS) options: BffModuleOptions,
  ) {
    this.refresh = refresh;
    this.options = options;
  }

  @Post('keep-alive')
  @HttpCode(200)
  @ApiCookieAuth(SESSION_SECURITY_SCHEME)
  @ApiOkResponse({ description: 'Session renewed', standardSchema: keepAliveResponseSchema })
  @ApiUnauthorizedResponse({ description: 'No session, or it has ended (the cookie is cleared)' })
  @ApiForbiddenResponse({ description: "Origin is missing or not the app's own" })
  @ApiServiceUnavailableResponse({ description: 'Keycloak could not be reached; the session is kept' })
  async keepAlive(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<KeepAliveResponse> {
    const result = await this.refresh.keepAlive(req);
    if (result.kind === 'unavailable') throw new ServiceUnavailableException();
    if (result.kind === 'ended') res.clearCookie(this.options.session.cookieName, { path: '/' });
    if (result.kind !== 'alive') throw new UnauthorizedException();
    return { idleExpiresAt: result.idleExpiresAt };
  }
}
