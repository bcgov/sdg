import { Logger } from '@nestjs/common';
import type { OidcClient } from '@repo/auth';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { SessionData } from 'express-session';

import { describeError } from '../logging/describe-error.js';
import { RELAY_STREAM_PATH } from '../notifications/relay-stream.path.js';
import { TOUCH_THRESHOLD_SECONDS } from './postgres-session.store.js';
import { sessionOp } from './session.module.js';
import './session.types.js';

/** Marks a request that is not a user action (count, list and stream loads, refetches); it never restarts the clock. */
export const BACKGROUND_HEADER = 'sdg-background';

export interface ActivityOptions {
  oidc: OidcClient;
  /** The idle limit, `SESSION_TTL_SECONDS`. */
  ttlSeconds: number;
}

/** True when a signed-in session's last user activity is older than the idle limit. */
export function idleExpired(session: SessionData, ttlSeconds: number, now = Date.now()): boolean {
  return session.lastActivityAt !== undefined && now - session.lastActivityAt > ttlSeconds * 1000;
}

/** The stream always counts as background, and its session copy must stay unmodified while it is open (KTD8). */
function isStream(req: Request): boolean {
  return new URL(req.originalUrl, 'http://localhost').pathname === RELAY_STREAM_PATH;
}

/**
 * Applies the idle limit (KTD8), after the session middleware and before any guard. An idle-expired session is ended
 * at the identity provider over the back channel and replaced by an empty one, so the request proceeds signed out.
 * Otherwise a request without the background marker stamps `lastActivityAt` when the stored value is older than the
 * store's touch threshold or a tenth of the idle limit, whichever is shorter, so sessions are not rewritten per request. A signed-in session without a stamp (signed
 * in moments ago, or before this existed) gets one at its next request, background or not.
 */
export function activityMiddleware({ oidc, ttlSeconds }: ActivityOptions): RequestHandler {
  const logger = new Logger('SessionActivity');
  // A tenth of a short idle limit, so a steadily active user is always re-stamped before the limit passes.
  const stampAfterMs = Math.min(TOUCH_THRESHOLD_SECONDS, Math.floor(ttlSeconds / 10)) * 1000;

  async function endIdleSession(req: Request, session: SessionData): Promise<void> {
    if (session.auth) {
      try {
        await oidc.endSession(session.auth.tokens);
      } catch (error) {
        logger.warn({
          msg: 'Ending the idle session at the identity provider failed; ending the portal session anyway',
          error: describeError(error),
        });
      }
    }
    await sessionOp(req, 'regenerate');
  }

  async function apply(req: Request): Promise<void> {
    const session = req.session;
    if (!session?.auth) return;
    const now = Date.now();
    if (idleExpired(session, ttlSeconds, now)) return endIdleSession(req, session);
    if (isStream(req)) return;
    const last = session.lastActivityAt;
    const userAction = req.get(BACKGROUND_HEADER) !== '1';
    if (last === undefined || (userAction && now - last > stampAfterMs)) {
      session.lastActivityAt = now;
    }
  }

  // Nest awaits functional middleware and sends a rejection through its exception filters.
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    await apply(req);
    next();
  };
}
