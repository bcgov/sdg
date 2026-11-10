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
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthError, safeReturnTo, type CallbackResult, type OidcClient, type PendingAuthorization } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import { describeError } from '@repo/server-core';
import type { Request, Response } from 'express';

import { BFF_OPTIONS, LOGIN_HOOK, SESSION_SECURITY_SCHEME, type BffModuleOptions } from '../nestjs/bff.options.js';
import { sessionOp } from '../session/session-op.js';
import {
  currentUserSchema,
  logoutResponseSchema,
  loginQuerySchema,
  type CurrentUserResponse,
  type LoginQuery,
  type LogoutResponse,
} from './auth.schemas.js';
import type { LoginHook, LoginOutcome } from './core-api-login.js';
import { SessionAuthGuard } from './session-auth.guard.js';

/** The `authError` the web app shows; `unavailable` offers a retry (AE7). */
export type AuthErrorCode = 'invalid_state' | 'access_denied' | 'login_failed' | 'unavailable';

function callbackErrorCode(error: unknown): AuthErrorCode {
  if (!(error instanceof AuthError)) return 'login_failed';
  if (error.code === 'invalid_state') return 'invalid_state';
  return error.detail === 'access_denied' ? 'access_denied' : 'login_failed';
}

/**
 * BFF login (R5, R11): the browser only ever sees redirects and an httpOnly session cookie. Unversioned by design.
 * The callback asks core-api for the principal before any session exists, so a refused or failed sign-in leaves none.
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: VERSION_NEUTRAL })
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly oidc: OidcClient;
  private readonly options: BffModuleOptions;
  private readonly onLogin: LoginHook;

  constructor(
    @Inject(OIDC_CLIENT) oidc: OidcClient,
    @Inject(BFF_OPTIONS) options: BffModuleOptions,
    @Inject(LOGIN_HOOK) onLogin: LoginHook,
  ) {
    this.oidc = oidc;
    this.options = options;
    this.onLogin = onLogin;
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
      this.logger.error({ msg: 'Could not start login', error: describeError(error) });
      throw new ServiceUnavailableException('Login is temporarily unavailable');
    }
    req.session.oidc = request.pending;
    await sessionOp(req, 'save');
    res.redirect(302, request.url.href);
  }

  @Get('callback')
  @ApiFoundResponse({
    description: 'Redirect to returnTo on success, or to <APP_URL>/?authError=<code> (or the refusal page) on failure',
  })
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const pending = req.session.oidc;
    delete req.session.oidc;
    if (!pending) {
      this.logger.warn({ msg: 'Login callback without a pending authorization' });
      return this.failLogin(req, res, 'invalid_state');
    }

    let login: CallbackResult;
    let outcome: LoginOutcome;
    try {
      login = await this.oidc.handleCallback(this.callbackUrl(req), pending);
      outcome = await this.onLogin(login);
    } catch (error) {
      const code = callbackErrorCode(error);
      this.logger.warn({ msg: `Login callback failed (${code})`, error: describeError(error) });
      return this.failLogin(req, res, code);
    }
    return this.finishLogin(req, res, { login, outcome, pending });
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth(SESSION_SECURITY_SCHEME)
  @ApiOkResponse({ description: 'The signed-in user', standardSchema: currentUserSchema })
  @ApiUnauthorizedResponse({ description: 'No authenticated session' })
  me(@Req() req: Request): CurrentUserResponse {
    // Session-local (KTD7): page loads never depend on core-api or Keycloak.
    const auth = req.session.auth!;
    return { id: auth.principalId, name: auth.user.name, email: auth.user.email };
  }

  @Post('logout')
  @HttpCode(200)
  @ApiCookieAuth(SESSION_SECURITY_SCHEME)
  @ApiOkResponse({ description: 'Session destroyed; navigate to redirectUrl', standardSchema: logoutResponseSchema })
  @ApiForbiddenResponse({ description: "Origin is missing or not the app's own" })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<LogoutResponse> {
    const auth = req.session.auth;
    let redirectUrl = `${this.options.appUrl}/`;
    if (auth) {
      try {
        redirectUrl = (await this.oidc.buildEndSessionUrl(auth.tokens.idToken)).href;
      } catch (error) {
        this.logger.warn({ msg: 'Keycloak logout URL unavailable', error: describeError(error) });
      }
    }
    await sessionOp(req, 'destroy');
    res.clearCookie(this.options.session.cookieName, { path: '/' });
    return { redirectUrl };
  }

  /** Acts on core-api's answer: a session only for an accepted principal. */
  private async finishLogin(
    req: Request,
    res: Response,
    { login, outcome, pending }: { login: CallbackResult; outcome: LoginOutcome; pending: PendingAuthorization },
  ): Promise<void> {
    if (outcome.kind === 'unavailable') {
      this.logger.warn({ msg: 'core-api unavailable at login', error: describeError(outcome.cause) });
      return this.failLogin(req, res, 'unavailable');
    }
    if (outcome.kind === 'refused') return this.refuseLogin(req, res, login);

    await sessionOp(req, 'regenerate');
    req.session.auth = {
      principalId: outcome.principalId,
      user: { name: login.user.name, email: login.user.email },
      tokens: login.tokens,
    };
    await sessionOp(req, 'save');
    res.redirect(302, pending.returnTo);
  }

  private async refuseLogin(req: Request, res: Response, login: CallbackResult): Promise<void> {
    this.logger.warn({ msg: 'core-api refused the login' });
    await this.endPendingSession(req, res);
    let location = `${this.options.appUrl}/?authError=access_denied`;
    if (this.options.onLoginRefused) {
      try {
        location = await this.options.onLoginRefused(login);
      } catch (error) {
        this.logger.error({ msg: 'Login refusal hook failed', error: describeError(error) });
      }
    }
    res.redirect(302, location);
  }

  /** The registered redirect URI plus this request's query; never derived from the Host header. */
  private callbackUrl(req: Request): URL {
    const url = new URL(`${this.options.appUrl}/api/auth/callback`);
    url.search = new URL(req.originalUrl, 'http://localhost').search;
    return url;
  }

  private async failLogin(req: Request, res: Response, code: AuthErrorCode): Promise<void> {
    await this.endPendingSession(req, res);
    res.redirect(302, `${this.options.appUrl}/?authError=${code}`);
  }

  /** Ends the pre-login session, which consumes its pending authorization and leaves no session row or cookie. */
  private async endPendingSession(req: Request, res: Response): Promise<void> {
    await sessionOp(req, 'destroy');
    res.clearCookie(this.options.session.cookieName, { path: '/' });
  }
}
