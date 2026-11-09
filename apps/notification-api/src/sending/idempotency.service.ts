import { createHash } from 'node:crypto';

import { ConflictException, Injectable } from '@nestjs/common';
import { IDEMPOTENCY_WINDOW_HOURS, idempotencyKeys, notifications } from '@repo/notification-database';
import { and, eq, sql } from 'drizzle-orm';

import { InjectDatabase, type DbOrTx, type NotificationDatabase } from '../database/database.module.js';
import type { SendResponse } from './send.schemas.js';

/** JSON with every object's keys sorted, so the same content always serializes the same way. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The hex SHA-256 of the canonical request body (KTD13). */
export function requestHash(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

/** A key still inside its window, with the notification it was used for. */
export interface UsedKey {
  requestHash: string;
  notification: SendResponse;
}

const WINDOW = sql.raw(`interval '${IDEMPOTENCY_WINDOW_HOURS} hours'`);
const withinWindow = sql`${idempotencyKeys.createdAt} > now() - ${WINDOW}`;

/**
 * Idempotency keys (KTD13): scoped to the sender, held 24 hours, each with the hash of the request it was used for.
 * A key past its window is unused, and claiming it again replaces it.
 */
@Injectable()
export class IdempotencyService {
  private readonly db: NotificationDatabase;

  constructor(@InjectDatabase() db: NotificationDatabase) {
    this.db = db;
  }

  /** The key's use inside its window, or null. */
  async find(senderId: string, key: string): Promise<UsedKey | null> {
    const [row] = await this.db
      .select({
        requestHash: idempotencyKeys.requestHash,
        notificationId: notifications.id,
        status: notifications.status,
      })
      .from(idempotencyKeys)
      .innerJoin(notifications, eq(notifications.id, idempotencyKeys.notificationId))
      .where(and(eq(idempotencyKeys.senderId, senderId), eq(idempotencyKeys.key, key), withinWindow));
    if (!row) return null;
    return { requestHash: row.requestHash, notification: { notificationId: row.notificationId, status: row.status } };
  }

  /** The original notification when the hash matches; 409 when the key was used for a different request (R28). */
  replay(used: UsedKey, hash: string): SendResponse {
    if (used.requestHash !== hash) {
      throw new ConflictException('This idempotency key was already used with a different request');
    }
    return used.notification;
  }

  /**
   * Records the key for the notification in the accept transaction. False when a live use of the key exists, such as
   * a concurrent send's that committed first: the caller rolls back and replays it.
   */
  async claim(tx: DbOrTx, senderId: string, key: string, hash: string, notificationId: string): Promise<boolean> {
    const rows = await tx
      .insert(idempotencyKeys)
      .values({ senderId, key, requestHash: hash, notificationId })
      .onConflictDoUpdate({
        target: [idempotencyKeys.senderId, idempotencyKeys.key],
        set: { requestHash: hash, notificationId, createdAt: sql`now()` },
        setWhere: sql`not (${withinWindow})`,
      })
      .returning({ key: idempotencyKeys.key });
    return rows.length > 0;
  }
}
