import { BadGatewayException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { isAuthError, type OidcClient, type OidcTokens } from '@repo/auth';
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
 * True when the session can't be refreshed again: the IdP rejected the refresh token (`invalid_grant`: expired,
 * revoked, or the SSO session ended) or there is none. Outages, timeouts and 5xx answers are worth another try.
 */
function refreshRejected(error: unknown): boolean {
  return (
    isAuthError(error) &&
    error.code === 'refresh_failed' &&
    (error.detail === 'invalid_grant' || error.detail === 'no refresh token')
  );
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
   * The session's access token, refreshed and saved first when it expires within 30 seconds. When the IdP rejects the
   * refresh (KTD16) the session is destroyed and this throws 401; any other refresh failure throws 502 and leaves the
   * session for the next call to retry.
   */
  async accessToken(req: Request): Promise<string> {
    const auth = req.session.auth;
    if (!auth) throw new UnauthorizedException();
    if (!expiresSoon(auth.tokens)) return auth.tokens.accessToken;

    let refreshed: OidcTokens;
    try {
      refreshed = await this.refreshOnce(req.sessionID, auth.tokens);
    } catch (error) {
      return this.refreshFailed(req, error);
    }
    auth.tokens = refreshed;
    await sessionOp(req, 'save');
    return refreshed.accessToken;
  }

  private async refreshFailed(req: Request, error: unknown): Promise<never> {
    if (!refreshRejected(error)) {
      this.logger.warn({ msg: 'Access token refresh failed; keeping the session', error: describeError(error) });
      throw new BadGatewayException('Sign-in could not be renewed right now; try again');
    }
    this.logger.warn({ msg: 'Access token refresh rejected; ending the session', error: describeError(error) });
    await sessionOp(req, 'destroy');
    throw new UnauthorizedException();
  }

  private refreshOnce(sessionId: string, current: OidcTokens): Promise<OidcTokens> {
    const existing = this.refreshes.get(sessionId);
    if (existing?.from === current.refreshToken) return existing.result;

    const refresh: Refresh = { from: current.refreshToken, result: this.oidc.refresh(current) };
    this.refreshes.set(sessionId, refresh);
    const forget = (): void => {
      if (this.refreshes.get(sessionId) === refresh) this.refreshes.delete(sessionId);
    };
    // A success is reused for a while (see SETTLED_REUSE_MS); a failure is forgotten at once so the next call retries.
    refresh.result.then(() => setTimeout(forget, SETTLED_REUSE_MS).unref(), forget);
    return refresh.result;
  }
}
