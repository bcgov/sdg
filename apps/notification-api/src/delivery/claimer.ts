import { Inject, Injectable } from '@nestjs/common';
import { deliveries, failureCallbacks } from '@repo/notification-database';
import { and, asc, eq, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, SelectedFieldsFlat } from 'drizzle-orm/pg-core';

import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import { CLOCK, DELIVERY_SETTINGS, type Clock, type DeliverySettings } from './settings.js';

/** The queue columns deliveries and failure callbacks share (KTD1). */
export interface QueueColumns {
  status: PgColumn;
  dueAt: PgColumn;
  leaseUntil: PgColumn;
}

/** Rows a worker may claim: scheduled rows that are due, and rows whose claim's lease ran out (a crashed worker's). */
export function claimable(table: QueueColumns, now: Date): SQL | undefined {
  return or(
    and(eq(table.status, 'scheduled'), lte(table.dueAt, now)),
    and(eq(table.status, 'sending'), lte(table.leaseUntil, now)),
  );
}

interface ClaimOptions {
  now: Date;
  limit: number;
  leaseMs: number;
}

/**
 * Claims up to `limit` due rows of a queue table (KTD1): `FOR UPDATE SKIP LOCKED` so concurrent workers never claim
 * the same row, then marks them `sending` under a lease and counts the claim as an attempt.
 */
export function claimDue<F extends SelectedFieldsFlat>(
  db: NotificationDatabase,
  table: typeof deliveries | typeof failureCallbacks,
  returning: F,
  { now, limit, leaseMs }: ClaimOptions,
) {
  const due = db
    .select({ id: table.id })
    .from(table)
    .where(claimable(table, now))
    .orderBy(asc(table.dueAt))
    .limit(limit)
    .for('update', { skipLocked: true });
  return db
    .update(table)
    .set({
      status: 'sending',
      leaseUntil: new Date(now.getTime() + leaseMs),
      attempts: sql`${table.attempts} + 1`,
      updatedAt: now,
    })
    .where(inArray(table.id, due))
    .returning(returning);
}

const claimedColumns = {
  id: deliveries.id,
  notificationId: deliveries.notificationId,
  notificationRecipientId: deliveries.notificationRecipientId,
  recipientId: deliveries.recipientId,
  channel: deliveries.channel,
  step: deliveries.step,
  contactPointId: deliveries.contactPointId,
  address: deliveries.address,
  attempts: deliveries.attempts,
};

/** A delivery a worker holds under a lease; `attempts` counts this claim. */
export type ClaimedDelivery = { [K in keyof typeof claimedColumns]: (typeof deliveries.$inferSelect)[K] };

/**
 * Claims due deliveries for one worker (KTD1): `FOR UPDATE SKIP LOCKED` so concurrent workers never claim the same
 * row, and a lease (the outbound timeout plus a margin) after which a crashed worker's row is claimed again with the
 * same delivery ID. Each claim counts as an attempt.
 */
@Injectable()
export class DeliveryClaimer {
  private readonly db: NotificationDatabase;
  private readonly settings: DeliverySettings;
  private readonly clock: Clock;

  constructor(
    @InjectDatabase() db: NotificationDatabase,
    @Inject(DELIVERY_SETTINGS) settings: DeliverySettings,
    @Inject(CLOCK) clock: Clock,
  ) {
    this.db = db;
    this.settings = settings;
    this.clock = clock;
  }

  async claim(limit = this.settings.batchSize): Promise<ClaimedDelivery[]> {
    return claimDue(this.db, deliveries, claimedColumns, {
      now: this.clock.now(),
      limit,
      leaseMs: this.settings.leaseMs,
    });
  }
}
