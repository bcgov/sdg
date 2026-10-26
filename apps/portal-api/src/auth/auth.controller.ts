import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiCookieAuth,
  ApiFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthError, safeReturnTo, type OidcClient } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import type { Request, Response } from 'express';

import type { Env } from '../config/env.js';
import { PrincipalsService } from '../principals/principals.service.js';
import { SESSION_COOKIE, sessionOp } from '../session/session.module.js';
import {
  currentUserSchema,
  logoutResponseSchema,
  loginQuerySchema,
  type CurrentUserResponse,
  type LoginQuery,
  type LogoutResponse,
} from './auth.schemas.js';
import { SessionAuthGuard } from './session-auth.guard.js';

export type AuthErrorCode = 'invalid_state' | 'access_denied' | 'login_failed';

function callbackErrorCode(error: unknown): AuthErrorCode {
  if (!(error instanceof AuthError)) return 'login_failed';
  if (error.code === 'invalid_state') return 'invalid_state';
  return error.detail === 'access_denied' ? 'access_denied' : 'login_failed';
}

/** BFF login: the browser only ever sees redirects and an httpOnly session cookie. Unversioned by design. */
@ApiTags('auth')
@Controller({ path: 'auth', version: VERSION_NEUTRAL })
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly oidc: OidcClient;
  private readonly principals: PrincipalsService;
  private readonly appUrl: string;

  constructor(
    @Inject(OIDC_CLIENT) oidc: OidcClient,
    @Inject(PrincipalsService) principals: PrincipalsService,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.oidc = oidc;
    this.principals = principals;
    this.appUrl = config.get('APP_URL', { infer: true });
  }

  @Get('login')
  @ApiFoundResponse({ description: 'Redirect to the Keycloak authorization endpoint' })
  @ApiServiceUnavailableResponse({ description: 'Keycloak discovery failed' })
  async login(
    @Query({ schema: loginQuerySchema }) { returnTo }: LoginQuery,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    let request: Awaited<ReturnType<OidcClient['createAuthorizationRequest']>>;
    try {
      request = await this.oidc.createAuthorizationRequest(safeReturnTo(returnTo, '/'));
    } catch (error) {
      this.logger.error('Could not start login', error instanceof Error ? error.stack : String(error));
      throw new ServiceUnavailableException('Login is temporarily unavailable');
    }
    req.session.oidc = request.pending;
    await sessionOp(req, 'save');
    res.redirect(302, request.url.href);
  }

  @Get('callback')
  @ApiFoundResponse({ description: 'Redirect to returnTo on success, or to <APP_URL>/?authError=<code> on failure' })
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const pending = req.session.oidc;
    delete req.session.oidc;
    if (!pending) {
      this.logger.warn('Login callback without a pending authorization');
      return this.failLogin(req, res, 'invalid_state');
    }

    let principalId: string;
    let login: Awaited<ReturnType<OidcClient['handleCallback']>>;
    try {
      login = await this.oidc.handleCallback(this.callbackUrl(req), pending);
      ({ principalId } = await this.principals.upsertFromLogin(login.user));
    } catch (error) {
      const code = callbackErrorCode(error);
      this.logger.warn(`Login callback failed (${code})`, error instanceof Error ? error.stack : String(error));
      return this.failLogin(req, res, code);
    }

    await sessionOp(req, 'regenerate');
    req.session.auth = {
      principalId,
      user: { name: login.user.name, email: login.user.email },
      tokens: login.tokens,
    };
    await sessionOp(req, 'save');
    res.redirect(302, pending.returnTo);
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiOkResponse({ description: 'The signed-in user', standardSchema: currentUserSchema })
  @ApiUnauthorizedResponse({ description: 'No authenticated session' })
  me(@Req() req: Request): CurrentUserResponse {
    const auth = req.session.auth!;
    return { id: auth.principalId, name: auth.user.name, email: auth.user.email };
  }

  @Post('logout')
  @HttpCode(200)
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiOkResponse({ description: 'Session destroyed; navigate to redirectUrl', standardSchema: logoutResponseSchema })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<LogoutResponse> {
    const auth = req.session.auth;
    let redirectUrl = `${this.appUrl}/`;
    if (auth) {
      try {
        redirectUrl = (await this.oidc.buildEndSessionUrl(auth.tokens.idToken)).href;
      } catch (error) {
        this.logger.warn('Keycloak logout URL unavailable', error instanceof Error ? error.stack : String(error));
      }
    }
    await sessionOp(req, 'destroy');
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { redirectUrl };
  }

  /** The registered redirect URI plus this request's query; never derived from the Host header. */
  private callbackUrl(req: Request): URL {
    const url = new URL(`${this.appUrl}/api/auth/callback`);
    url.search = new URL(req.originalUrl, 'http://localhost').search;
    return url;
  }

  private async failLogin(req: Request, res: Response, code: AuthErrorCode): Promise<void> {
    await sessionOp(req, 'save');
    res.redirect(302, `${this.appUrl}/?authError=${code}`);
  }
}
