import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';

import { InjectDatabase, type DbOrTx, type NotificationDatabase } from '../database/database.module.js';
import { inboxItems, notificationRecipients, notifications } from '../database/schema/index.js';
import { cancelPendingSteps, type CANCEL_REASONS } from '../delivery/escalation.js';
import { CLOCK, type Clock } from '../delivery/settings.js';
import { inboxItemContent } from '../history/history.service.js';
import { afterCursor, toPage } from '../http/pagination.js';
import type { InboxItemResponse, InboxPage, InboxQuery } from './inbox.schemas.js';

const itemColumns = {
  id: inboxItems.id,
  notificationId: inboxItems.notificationId,
  type: notifications.typeKey,
  title: inboxItems.title,
  body: inboxItems.body,
  actionUrl: inboxItems.actionUrl,
  language: inboxItems.language,
  readAt: inboxItems.readAt,
  acknowledgedAt: inboxItems.acknowledgedAt,
  createdAt: inboxItems.createdAt,
};

interface ItemRow {
  id: string;
  notificationId: string;
  type: string;
  title: string | null;
  body: string | null;
  actionUrl: string | null;
  language: string | null;
  readAt: Date | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
}

function toItem(row: ItemRow): InboxItemResponse {
  return { id: row.id, notificationId: row.notificationId, type: row.type, ...inboxItemContent(row) };
}

/**
 * The in-app inbox (R50): a recipient lists, reads and acknowledges only their own items (R12). Reading or
 * acknowledging stops the item's escalation (R18). Another recipient's item is a 404.
 */
@Injectable()
export class InboxService {
  private readonly db: NotificationDatabase;
  private readonly clock: Clock;

  constructor(@InjectDatabase() db: NotificationDatabase, @Inject(CLOCK) clock: Clock) {
    this.db = db;
    this.clock = clock;
  }

  /** The recipient's items, newest first, a cursor page at a time. */
  async list(recipientId: string, { cursor, limit }: InboxQuery): Promise<InboxPage> {
    const rows = await this.selectItems(
      this.db,
      and(eq(inboxItems.recipientId, recipientId), afterCursor(inboxItems, cursor)),
    )
      .orderBy(desc(inboxItems.createdAt), desc(inboxItems.id))
      .limit(limit + 1);
    const { page, nextCursor } = toPage(rows, limit);
    return { items: page.map(toItem), nextCursor };
  }

  /** Sets the read time once and stops the escalation (R18). Repeating it changes nothing. */
  read(recipientId: string, itemId: string): Promise<InboxItemResponse> {
    return this.mark(recipientId, itemId, 'read');
  }

  /** Sets the acknowledged time once, and the read time if unread, and stops the escalation (R18). */
  acknowledge(recipientId: string, itemId: string): Promise<InboxItemResponse> {
    return this.mark(recipientId, itemId, 'acknowledged');
  }

  private async mark(
    recipientId: string,
    itemId: string,
    cause: keyof typeof CANCEL_REASONS,
  ): Promise<InboxItemResponse> {
    const now = this.clock.now();
    const owned = and(eq(inboxItems.id, itemId), eq(inboxItems.recipientId, recipientId));
    return this.db.transaction(async (tx) => {
      const [item] = await tx
        .select({ notificationRecipientId: inboxItems.notificationRecipientId })
        .from(inboxItems)
        .where(owned);
      if (!item) throw new NotFoundException('No inbox item with this id');
      // The lock the delivery worker takes to record a step, so a step finishing now can't schedule the next one
      // after it was cancelled (escalation.ts).
      await tx
        .select({ id: notificationRecipients.id })
        .from(notificationRecipients)
        .where(eq(notificationRecipients.id, item.notificationRecipientId))
        .for('update');
      const readAt = sql`coalesce(${inboxItems.readAt}, ${now.toISOString()}::timestamptz)`;
      const acknowledgedAt = sql`coalesce(${inboxItems.acknowledgedAt}, ${now.toISOString()}::timestamptz)`;
      await tx
        .update(inboxItems)
        .set(cause === 'read' ? { readAt } : { readAt, acknowledgedAt })
        .where(owned);
      await cancelPendingSteps(tx, item.notificationRecipientId, cause, now);
      const [row] = await this.selectItems(tx, owned);
      if (!row) throw new NotFoundException('No inbox item with this id');
      return toItem(row);
    });
  }

  private selectItems(db: DbOrTx, where: SQL | undefined) {
    return db
      .select(itemColumns)
      .from(inboxItems)
      .innerJoin(notifications, eq(notifications.id, inboxItems.notificationId))
      .where(where);
  }
}
