import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, sql } from 'drizzle-orm';

import type { NotificationTransaction } from '../database/database.module.js';
import { confirmationSends } from '../database/schema/index.js';

/** R36's limits (KTD15). */
export const CONFIRMATION_LIMITS = {
  perRecipientPerHour: 5,
  perAddressPerHour: 3,
  /** Before a pending address can be sent another confirmation. */
  cooldownMs: 10 * 60 * 1000,
} as const;

const HOUR_MS = 60 * 60 * 1000;

/** 429 with a message that says which limit was hit and when to try again. */
function tooMany(message: string, retryAfterSeconds: number): HttpException {
  return new HttpException(
    { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'Too Many Requests', message, retryAfterSeconds },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * Postgres counters for confirmation emails (R36, KTD15): each send is a row, and a new one is allowed only while
 * the recipient has fewer than 5 in the last hour, the address fewer than 3, and the recipient's last send to the
 * address is over 10 minutes old.
 */
@Injectable()
export class RateLimitService {
  /**
   * Records a send to `address` for `recipientId` and returns the reservation's id, or throws a 429. Call inside the
   * transaction that issues the token: the transaction-scoped advisory locks make concurrent requests for one
   * recipient or address count in turn, and a rollback takes the reservation back.
   */
  async reserveConfirmation(tx: NotificationTransaction, recipientId: string, address: string): Promise<string> {
    // Always recipient before address, so two transactions never wait on each other's second lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`confirm:recipient:${recipientId}`}, 0))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`confirm:address:${address}`}, 0))`);
    const now = Date.now();
    const hourAgo = new Date(now - HOUR_MS);
    const [[byRecipient], [byAddress], [last]] = await Promise.all([
      tx
        .select({ sends: count() })
        .from(confirmationSends)
        .where(and(eq(confirmationSends.recipientId, recipientId), gt(confirmationSends.sentAt, hourAgo))),
      tx
        .select({ sends: count() })
        .from(confirmationSends)
        .where(and(eq(confirmationSends.address, address), gt(confirmationSends.sentAt, hourAgo))),
      tx
        .select({ sentAt: confirmationSends.sentAt })
        .from(confirmationSends)
        .where(and(eq(confirmationSends.recipientId, recipientId), eq(confirmationSends.address, address)))
        .orderBy(desc(confirmationSends.sentAt))
        .limit(1),
    ]);
    if ((byRecipient?.sends ?? 0) >= CONFIRMATION_LIMITS.perRecipientPerHour) {
      throw tooMany('Too many confirmation emails in the last hour: try again later', 3600);
    }
    if ((byAddress?.sends ?? 0) >= CONFIRMATION_LIMITS.perAddressPerHour) {
      throw tooMany('Too many confirmation emails to this address in the last hour: try again later', 3600);
    }
    const waitMs = last ? last.sentAt.getTime() + CONFIRMATION_LIMITS.cooldownMs - now : 0;
    if (waitMs > 0) {
      throw tooMany(
        'A confirmation email was sent to this address recently: wait before asking for another',
        Math.ceil(waitMs / 1000),
      );
    }
    const [reserved] = await tx
      .insert(confirmationSends)
      .values({ recipientId, address, sentAt: new Date(now) })
      .returning({ id: confirmationSends.id });
    if (!reserved) throw new Error('Reserving a confirmation send returned no row');
    return reserved.id;
  }
}
