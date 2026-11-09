import { Logger } from '@nestjs/common';
import { sessions } from '@repo/portal-database';
import { and, eq, gt, lt } from 'drizzle-orm';
import { Store, type SessionData } from 'express-session';

import type { PortalDatabase } from '../database/database.module.js';
import { describeError } from '../logging/describe-error.js';
import { decryptSession, encryptSession } from './session-cipher.js';

export interface PostgresSessionStoreOptions {
  /** Encryption key for the stored payload (see `deriveSessionKey`). */
  key: Buffer;
  /** Fallback lifetime when a session has no cookie expiry. */
  ttlSeconds: number;
  /** `touch` only writes when it moves the expiry by more than this, so rolling sessions don't write per request. */
  touchThresholdSeconds?: number;
}

/** The default `touchThresholdSeconds`: rolling sessions write their expiry at most every 5 minutes. */
export const TOUCH_THRESHOLD_SECONDS = 300;

type Callback<T> = (error: unknown, value?: T) => void;

const logger = new Logger('SessionStore');

/**
 * express-session store on the portal database. Payloads are encrypted: they carry OIDC tokens. Expired rows are
 * never read; a pg_cron job deletes them (portal-database migration 0002_prune_sessions).
 */
export class PostgresSessionStore extends Store {
  private readonly db: PortalDatabase;
  private readonly key: Buffer;
  private readonly ttlMs: number;
  private readonly touchThresholdMs: number;

  constructor(db: PortalDatabase, options: PostgresSessionStoreOptions) {
    super();
    this.db = db;
    this.key = options.key;
    this.ttlMs = options.ttlSeconds * 1000;
    this.touchThresholdMs = (options.touchThresholdSeconds ?? TOUCH_THRESHOLD_SECONDS) * 1000;
  }

  override get(sid: string, callback: Callback<SessionData | null>): void {
    settle('get', this.read(sid), callback);
  }

  override set(sid: string, session: SessionData, callback?: Callback<void>): void {
    settle('set', this.write(sid, session), callback);
  }

  override destroy(sid: string, callback?: Callback<void>): void {
    settle('destroy', this.remove(sid), callback);
  }

  override touch(sid: string, session: SessionData, callback?: Callback<void>): void {
    settle('touch', this.extend(sid, session), callback);
  }

  /**
   * Stamps `lastActivityAt` on the stored session in one locked read-modify-write (KTD8), so the request's own session
   * copy stays unmodified and express-session never saves it over tokens a concurrent request stored. It writes only
   * when the stored stamp is missing or older than `at - staleAfterMs` (`Infinity`: only when missing), so a stamp never
   * moves backwards. A stamp also keeps the row for at least the lifetime from `at`, as saving the copy would have; a
   * missing or expired session is left alone.
   */
  async stampActivity(sid: string, at: number, staleAfterMs: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ sess: sessions.sess, expiresAt: sessions.expiresAt })
        .from(sessions)
        .where(and(eq(sessions.sid, sid), gt(sessions.expiresAt, new Date())))
        .for('update');
      if (!row) return;
      const data = this.decode(row.sess, sid);
      if (data.lastActivityAt !== undefined && at - data.lastActivityAt <= staleAfterMs) return;
      const sess = encryptSession(this.key, JSON.stringify({ ...data, lastActivityAt: at }), sid);
      const expiresAt = new Date(Math.max(row.expiresAt.getTime(), at + this.ttlMs));
      await tx.update(sessions).set({ sess, expiresAt }).where(eq(sessions.sid, sid));
    });
  }

  private async read(sid: string): Promise<SessionData | null> {
    const [row] = await this.db
      .select({ sess: sessions.sess })
      .from(sessions)
      .where(and(eq(sessions.sid, sid), gt(sessions.expiresAt, new Date())));
    if (!row) return null;
    try {
      return this.decode(row.sess, sid);
    } catch (error) {
      // Unreadable (e.g. SESSION_SECRET rotated): treat as signed out rather than failing the request.
      logger.warn(`Discarding unreadable session: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Saves a request's session copy, keeping the stored `lastActivityAt` when it is newer: a copy loaded before a
   * concurrent request's stamp (e.g. a background token refresh) must not roll the idle clock back.
   */
  private async write(sid: string, session: SessionData): Promise<void> {
    const expiresAt = this.expiryOf(session);
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ sess: sessions.sess })
        .from(sessions)
        .where(and(eq(sessions.sid, sid), gt(sessions.expiresAt, new Date())))
        .for('update');
      const stored = row ? this.decode(row.sess, sid).lastActivityAt : undefined;
      const lastActivityAt = latest(session.lastActivityAt, stored);
      const sess = encryptSession(this.key, JSON.stringify({ ...session, lastActivityAt }), sid);
      await tx
        .insert(sessions)
        .values({ sid, sess, expiresAt })
        .onConflictDoUpdate({ target: sessions.sid, set: { sess, expiresAt } });
    });
  }

  private async remove(sid: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.sid, sid));
  }

  private async extend(sid: string, session: SessionData): Promise<void> {
    const expiresAt = this.expiryOf(session);
    const stale = new Date(expiresAt.getTime() - this.touchThresholdMs);
    await this.db
      .update(sessions)
      .set({ expiresAt })
      .where(and(eq(sessions.sid, sid), lt(sessions.expiresAt, stale)));
  }

  private decode(sess: string, sid: string): SessionData {
    const data: SessionData = JSON.parse(decryptSession(this.key, sess, sid));
    return data;
  }

  private expiryOf(session: SessionData): Date {
    const expires = session.cookie.expires;
    return expires ? new Date(expires) : new Date(Date.now() + this.ttlMs);
  }
}

/** The later of two optional epoch-millisecond stamps. */
function latest(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  return b === undefined ? a : Math.max(a, b);
}

/** Bridges to express-session's callback API. The callback runs outside the try, so its own throws aren't misreported. */
function settle<T>(operation: string, promise: Promise<T>, callback?: Callback<T>): void {
  const run = async (): Promise<void> => {
    let value: T;
    try {
      value = await promise;
    } catch (error) {
      if (callback) callback(error);
      else logger.error({ msg: `Session ${operation} failed`, error: describeError(error) });
      return;
    }
    callback?.(null, value);
  };
  void run();
}
