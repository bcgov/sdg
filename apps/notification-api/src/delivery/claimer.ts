import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import { deliveries } from '../database/schema/index.js';
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
    const now = this.clock.now();
    const due = this.db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(claimable(deliveries, now))
      .orderBy(asc(deliveries.dueAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    return this.db
      .update(deliveries)
      .set({
        status: 'sending',
        leaseUntil: new Date(now.getTime() + this.settings.leaseMs),
        attempts: sql`${deliveries.attempts} + 1`,
        updatedAt: now,
      })
      .where(inArray(deliveries.id, due))
      .returning(claimedColumns);
  }
}
