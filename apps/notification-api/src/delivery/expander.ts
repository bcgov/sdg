import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, isNull, sql, type SQL } from 'drizzle-orm';

import { InjectDatabase, type DbOrTx, type NotificationDatabase } from '../database/database.module.js';
import { notifications } from '../database/schema/index.js';
import { subscribersQuery } from '../recipients/subscriptions.service.js';
import { CLOCK, DELIVERY_SETTINGS, type Clock, type DeliverySettings } from './settings.js';

interface Unexpanded {
  id: string;
  senderId: string;
  audienceKind: (typeof notifications.$inferSelect)['audienceKind'];
  topicId: string | null;
}

/**
 * "Everyone" (R30): the users the sender registered, its systems and the current subscribers of its own topics,
 * unioned by id. Address-only recipients are left out by the caller.
 */
function everyoneQuery(senderId: string): SQL {
  return sql`
    SELECT recipient_id FROM recipient_registrations WHERE sender_id = ${senderId}
    UNION SELECT id FROM recipients WHERE kind = 'system' AND sender_id = ${senderId}
    UNION SELECT s.recipient_id FROM topic_subscriptions s JOIN topics t ON t.id = s.topic_id
      WHERE t.sender_id = ${senderId}`;
}

/** The recipient ids the notification's audience names right now, or null when it names none (a deleted topic). */
function audienceQuery(db: DbOrTx, notification: Unexpanded): SQL | null {
  if (notification.audienceKind === 'everyone') return everyoneQuery(notification.senderId);
  if (notification.audienceKind === 'recipients') {
    return sql`SELECT unnest(recipient_ids) FROM notifications WHERE id = ${notification.id}`;
  }
  return notification.topicId === null ? null : sql`${subscribersQuery(db, notification.topicId)}`;
}

/**
 * Fixes each accepted notification's audience (R31, KTD14): one set-based `INSERT … SELECT` into notification
 * recipients, guarded by the unique (notification, recipient) pair, in the same transaction that marks it expanded.
 * A repeated expansion adds nobody, and recipients who join the audience later never receive it.
 */
@Injectable()
export class ExpanderService {
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

  /** Expands up to a batch of notifications, oldest first, and resolves how many it expanded. */
  async expandBatch(): Promise<number> {
    let expanded = 0;
    // oxlint-disable-next-line no-await-in-loop -- one notification per transaction, each claimed with SKIP LOCKED.
    while (expanded < this.settings.batchSize && (await this.expandOne())) expanded += 1;
    return expanded;
  }

  /** Expands the oldest unexpanded notification no other worker holds; false when there is none. */
  private expandOne(): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [notification] = await tx
        .select({
          id: notifications.id,
          senderId: notifications.senderId,
          audienceKind: notifications.audienceKind,
          topicId: notifications.topicId,
        })
        .from(notifications)
        .where(isNull(notifications.expandedAt))
        .orderBy(asc(notifications.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!notification) return false;
      await this.insertAudience(tx, notification);
      await tx
        .update(notifications)
        .set({ status: 'expanded', expandedAt: this.clock.now() })
        .where(eq(notifications.id, notification.id));
      return true;
    });
  }

  /** Re-running it for the same notification inserts nothing new: the unique pair turns repeats into no-ops. */
  private async insertAudience(db: DbOrTx, notification: Unexpanded): Promise<void> {
    const audience = audienceQuery(db, notification);
    if (audience === null) return;
    const withoutAddresses = notification.audienceKind === 'everyone' ? sql`AND kind <> 'address'` : sql``;
    await db.execute(sql`
      INSERT INTO notification_recipients (notification_id, recipient_id)
      SELECT ${notification.id}, id FROM recipients WHERE id IN (${audience}) ${withoutAddresses}
      ON CONFLICT (notification_id, recipient_id) DO NOTHING`);
  }
}
