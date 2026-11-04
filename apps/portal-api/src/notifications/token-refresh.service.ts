import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { OidcClient, OidcTokens } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import type { Request } from 'express';

import { describeError } from '../logging/describe-error.js';
import { sessionOp } from '../session/session.module.js';

/** An access token expiring within this window is refreshed before it is relayed (KTD16). */
export const REFRESH_WINDOW_MS = 30_000;
/**
 * How long a finished refresh is still handed to requests presenting the refresh token it replaced. A request that
 * loaded the session just before the new tokens were saved would otherwise redeem the rotated-out refresh token.
 */
const SETTLED_REUSE_MS = 30_000;

interface Refresh {
  /** The refresh token this refresh redeems. */
  from: string | null;
  result: Promise<OidcTokens>;
}

function expiresSoon(tokens: OidcTokens): boolean {
  return tokens.expiresAt !== null && tokens.expiresAt - Date.now() <= REFRESH_WINDOW_MS;
}

/**
 * Keeps the session's access token fresh for relayed calls. Refreshes are serialized per session in process, so
 * concurrent requests on one session redeem its refresh token once.
 */
@Injectable()
export class TokenRefreshService {
  private readonly logger = new Logger(TokenRefreshService.name);
  private readonly oidc: OidcClient;
  private readonly refreshes = new Map<string, Refresh>();

  constructor(@Inject(OIDC_CLIENT) oidc: OidcClient) {
    this.oidc = oidc;
  }

  /**
   * The session's access token, refreshed and saved first when it expires within 30 seconds. A failed refresh
   * destroys the session and throws 401.
   */
  async accessToken(req: Request): Promise<string> {
    const auth = req.session.auth;
    if (!auth) throw new UnauthorizedException();
    if (!expiresSoon(auth.tokens)) return auth.tokens.accessToken;

    let refreshed: OidcTokens;
    try {
      refreshed = await this.refreshOnce(req.sessionID, auth.tokens);
    } catch (error) {
      this.logger.warn({ msg: 'Access token refresh failed; ending the session', error: describeError(error) });
      await sessionOp(req, 'destroy');
      throw new UnauthorizedException();
    }
    auth.tokens = refreshed;
    await sessionOp(req, 'save');
    return refreshed.accessToken;
  }

  private refreshOnce(sessionId: string, current: OidcTokens): Promise<OidcTokens> {
    const existing = this.refreshes.get(sessionId);
    if (existing?.from === current.refreshToken) return existing.result;

    const refresh: Refresh = { from: current.refreshToken, result: this.oidc.refresh(current) };
    this.refreshes.set(sessionId, refresh);
    const forget = (): void => {
      setTimeout(() => {
        if (this.refreshes.get(sessionId) === refresh) this.refreshes.delete(sessionId);
      }, SETTLED_REUSE_MS).unref();
    };
    refresh.result.then(forget, forget);
    return refresh.result;
  }
}
