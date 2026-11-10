import { Inject, Injectable, Logger } from '@nestjs/common';
import { isAuthError, type OidcClient, type OidcTokens } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import { describeError } from '@repo/server-core';
import type { Request } from 'express';

import { SESSION_STORE } from '../nestjs/bff.options.js';
import type { PostgresSessionStore } from '../session/postgres-session.store.js';
import { sessionOp } from '../session/session-op.js';

/** An access token expiring within this window is refreshed before it is forwarded (R6, R30). */
export const REFRESH_WINDOW_MS = 30_000;
/**
 * How long a finished refresh is still handed to requests presenting the refresh token it replaced. A request that
 * loaded the session just before the new tokens were saved would otherwise redeem the rotated-out refresh token.
 */
const SETTLED_REUSE_MS = 30_000;

/** The session's access token, or why there is none. */
export type SessionToken =
  | { readonly kind: 'token'; readonly token: string }
  /** No signed-in session: 401. */
  | { readonly kind: 'signed-out' }
  /** The session just ended (refresh rejected, or ended elsewhere): 401, and the cookie should be cleared. */
  | { readonly kind: 'ended' }
  /** The IdP could not be reached or failed; the session is kept for a retry: 503. */
  | { readonly kind: 'unavailable' };

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
 * Keeps the session's access token fresh for forwarded calls (R6, KTD7). Refreshes are deduplicated per session in
 * process, so concurrent requests on one session redeem its refresh token once. Across pods, a rejected refresh first
 * re-reads the session row: another pod may already have redeemed the token and saved newer ones.
 */
@Injectable()
export class TokenRefreshService {
  private readonly logger = new Logger(TokenRefreshService.name);
  private readonly oidc: OidcClient;
  private readonly store: PostgresSessionStore;
  private readonly refreshes = new Map<string, Refresh>();

  constructor(@Inject(OIDC_CLIENT) oidc: OidcClient, @Inject(SESSION_STORE) store: PostgresSessionStore) {
    this.oidc = oidc;
    this.store = store;
  }

  /** The session's access token, refreshed and saved first when it expires within REFRESH_WINDOW_MS. */
  async accessToken(req: Request): Promise<SessionToken> {
    const auth = req.session?.auth;
    if (!auth) return { kind: 'signed-out' };
    if (!expiresSoon(auth.tokens)) return { kind: 'token', token: auth.tokens.accessToken };

    let refreshed: OidcTokens;
    try {
      refreshed = await this.refreshOnce(req.sessionID, auth.tokens);
    } catch (error) {
      return this.refreshFailed(req, auth.tokens, error);
    }
    return this.saveTokens(req, refreshed);
  }

  /** Ends the session: core-api rejected its token (KTD3), or its refresh was rejected. */
  async endSession(req: Request): Promise<void> {
    if (req.session) await sessionOp(req, 'destroy');
  }

  private async saveTokens(req: Request, tokens: OidcTokens): Promise<SessionToken> {
    const auth = req.session.auth;
    if (!auth) return { kind: 'ended' };
    auth.tokens = tokens;
    await sessionOp(req, 'save');
    if (this.store.wasDestroyed(req.session)) {
      // Signed out (here or on another pod) while the refresh ran: the tombstone kept the row ended, and dropping
      // req.session stops express-session from setting the cookie again on this response.
      this.logger.log({ msg: 'Session ended while its tokens were refreshed' });
      await sessionOp(req, 'destroy');
      return { kind: 'ended' };
    }
    return { kind: 'token', token: tokens.accessToken };
  }

  private async refreshFailed(req: Request, tried: OidcTokens, error: unknown): Promise<SessionToken> {
    if (!refreshRejected(error)) {
      this.logger.warn({ msg: 'Access token refresh failed; keeping the session', error: describeError(error) });
      return { kind: 'unavailable' };
    }
    const stored = (await this.store.readSession(req.sessionID))?.auth;
    if (stored && stored.tokens.refreshToken !== tried.refreshToken) {
      // Another pod redeemed the refresh token first and saved what it got back; use that.
      return this.saveTokens(req, stored.tokens);
    }
    this.logger.warn({ msg: 'Access token refresh rejected; ending the session', error: describeError(error) });
    await this.endSession(req);
    return { kind: 'ended' };
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
