import { Logger } from '@nestjs/common';
import { sessions } from '@repo/portal-database';
import { and, eq, gt, lt, lte } from 'drizzle-orm';
import { Store, type SessionData } from 'express-session';

import type { PortalDatabase } from '../database/database.module.js';
import { decryptSession, encryptSession } from './session-cipher.js';

export interface PostgresSessionStoreOptions {
  /** Encryption key for the stored payload (see `deriveSessionKey`). */
  key: Buffer;
  /** Fallback lifetime when a session has no cookie expiry. */
  ttlSeconds: number;
  /** `touch` only writes when it moves the expiry by more than this, so rolling sessions don't write per request. */
  touchThresholdSeconds?: number;
}

type Callback<T> = (error: unknown, value?: T) => void;

const logger = new Logger('SessionStore');

/** express-session store on the portal database. Payloads are encrypted: they carry OIDC tokens. */
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
    this.touchThresholdMs = (options.touchThresholdSeconds ?? 300) * 1000;
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

  /** Deletes expired sessions and returns how many were removed. */
  async prune(): Promise<number> {
    const deleted = await this.db
      .delete(sessions)
      .where(lte(sessions.expiresAt, new Date()))
      .returning({ sid: sessions.sid });
    return deleted.length;
  }

  private async read(sid: string): Promise<SessionData | null> {
    const [row] = await this.db
      .select({ sess: sessions.sess })
      .from(sessions)
      .where(and(eq(sessions.sid, sid), gt(sessions.expiresAt, new Date())));
    if (!row) return null;
    try {
      const data: SessionData = JSON.parse(decryptSession(this.key, row.sess, sid));
      return data;
    } catch (error) {
      // Unreadable (e.g. SESSION_SECRET rotated): treat as signed out rather than failing the request.
      logger.warn(`Discarding unreadable session: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async write(sid: string, session: SessionData): Promise<void> {
    const sess = encryptSession(this.key, JSON.stringify(session), sid);
    const expiresAt = this.expiryOf(session);
    await this.db
      .insert(sessions)
      .values({ sid, sess, expiresAt })
      .onConflictDoUpdate({ target: sessions.sid, set: { sess, expiresAt } });
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

  private expiryOf(session: SessionData): Date {
    const expires = session.cookie.expires;
    return expires ? new Date(expires) : new Date(Date.now() + this.ttlMs);
  }
}

/** Bridges to express-session's callback API. The callback runs outside the try, so its own throws aren't misreported. */
function settle<T>(operation: string, promise: Promise<T>, callback?: Callback<T>): void {
  const run = async (): Promise<void> => {
    let value: T;
    try {
      value = await promise;
    } catch (error) {
      if (callback) callback(error);
      else logger.error(`Session ${operation} failed`, error instanceof Error ? error.stack : String(error));
      return;
    }
    callback?.(null, value);
  };
  void run();
}
