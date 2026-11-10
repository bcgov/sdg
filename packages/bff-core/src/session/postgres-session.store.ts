import { describeError } from '@repo/server-core';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { Store, type SessionData } from 'express-session';

import { decryptSession, encryptSession } from './session-cipher.js';
import type { SessionDatabase } from './session-database.js';
import { sessions } from './sessions.schema.js';

/** Satisfied by Nest's `Logger`; entries follow the repo's `{ msg, error: describeError(error) }` shape. */
export interface SessionStoreLogger {
  warn(entry: { msg: string; [key: string]: unknown }): void;
  error(entry: { msg: string; [key: string]: unknown }): void;
}

export interface PostgresSessionStoreOptions {
  /** Encryption key for the stored payload (see `deriveSessionKey`). */
  key: Buffer;
  /** Fallback lifetime when a session has no cookie expiry. */
  ttlSeconds: number;
  /** `touch` only writes when it moves the expiry by more than this, so rolling sessions don't write per request. */
  touchThresholdSeconds?: number;
  logger: SessionStoreLogger;
}

type Callback<T> = (error: unknown, value?: T) => void;

/**
 * express-session store on the BFF login's `sessions` table. Payloads are encrypted: they carry OIDC tokens.
 *
 * Safe across pods (KTD7): `destroy` leaves a tombstone (`destroyed_at`, payload wiped) instead of deleting the row,
 * and `set` updates only rows without one. A request that loaded the session before another pod ended it can still
 * save (e.g. refreshed tokens), but the save changes nothing and the session stays ended. A new session id has no row,
 * so express-session's first save inserts as usual. Reads skip tombstoned and expired rows; the prune job deletes them.
 */
export class PostgresSessionStore extends Store {
  private readonly db: SessionDatabase;
  private readonly key: Buffer;
  private readonly ttlMs: number;
  private readonly touchThresholdMs: number;
  private readonly logger: SessionStoreLogger;
  /** Sessions (express-session's per-request objects) whose last save found a tombstone. */
  private readonly ended = new WeakSet<SessionData>();

  constructor(db: SessionDatabase, options: PostgresSessionStoreOptions) {
    super();
    this.db = db;
    this.key = options.key;
    this.ttlMs = options.ttlSeconds * 1000;
    this.touchThresholdMs = (options.touchThresholdSeconds ?? 300) * 1000;
    this.logger = options.logger;
  }

  override get(sid: string, callback: Callback<SessionData | null>): void {
    this.settle('get', this.readSession(sid), callback);
  }

  override set(sid: string, session: SessionData, callback?: Callback<void>): void {
    this.settle('set', this.write(sid, session), callback);
  }

  override destroy(sid: string, callback?: Callback<void>): void {
    this.settle('destroy', this.remove(sid), callback);
  }

  override touch(sid: string, session: SessionData, callback?: Callback<void>): void {
    this.settle('touch', this.extend(sid, session), callback);
  }

  /** The live session stored under `sid`, read from the database now; null when missing, ended, expired or unreadable. */
  async readSession(sid: string): Promise<SessionData | null> {
    const [row] = await this.db
      .select({ sess: sessions.sess })
      .from(sessions)
      .where(and(eq(sessions.sid, sid), gt(sessions.expiresAt, new Date()), isNull(sessions.destroyedAt)));
    if (!row) return null;
    try {
      const data: SessionData = JSON.parse(decryptSession(this.key, row.sess, sid));
      return data;
    } catch (error) {
      // Unreadable (e.g. SESSION_SECRET rotated): treat as signed out rather than failing the request.
      this.logger.warn({ msg: 'Discarding unreadable session', error: describeError(error) });
      return null;
    }
  }

  /** True when this session object's last save found its row ended (destroyed by another request or pod). */
  wasDestroyed(session: SessionData): boolean {
    return this.ended.has(session);
  }

  private async write(sid: string, session: SessionData): Promise<void> {
    const sess = encryptSession(this.key, JSON.stringify(session), sid);
    const expiresAt = this.expiryOf(session);
    const written = await this.db
      .insert(sessions)
      .values({ sid, sess, expiresAt })
      .onConflictDoUpdate({ target: sessions.sid, set: { sess, expiresAt }, setWhere: isNull(sessions.destroyedAt) })
      .returning({ sid: sessions.sid });
    if (written.length === 0) this.ended.add(session);
    else this.ended.delete(session);
  }

  private async remove(sid: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ sess: '', destroyedAt: sql`now()` })
      .where(and(eq(sessions.sid, sid), isNull(sessions.destroyedAt)));
  }

  private async extend(sid: string, session: SessionData): Promise<void> {
    const expiresAt = this.expiryOf(session);
    const stale = new Date(expiresAt.getTime() - this.touchThresholdMs);
    await this.db
      .update(sessions)
      .set({ expiresAt })
      .where(and(eq(sessions.sid, sid), lt(sessions.expiresAt, stale), isNull(sessions.destroyedAt)));
  }

  private expiryOf(session: SessionData): Date {
    const expires = session.cookie.expires;
    return expires ? new Date(expires) : new Date(Date.now() + this.ttlMs);
  }

  /** Bridges to express-session's callback API. The callback runs outside the try, so its own throws aren't misreported. */
  private settle<T>(operation: string, promise: Promise<T>, callback?: Callback<T>): void {
    const run = async (): Promise<void> => {
      let value: T;
      try {
        value = await promise;
      } catch (error) {
        if (callback) callback(error);
        else this.logger.error({ msg: `Session ${operation} failed`, error: describeError(error) });
        return;
      }
      callback?.(null, value);
    };
    void run();
  }
}
