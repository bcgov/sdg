import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import { inboxItems, notificationRecipients } from '../database/schema/index.js';
import { cancelPendingSteps, type CANCEL_REASONS } from '../delivery/escalation.js';
import { CLOCK, type Clock } from '../delivery/settings.js';
import { InboxQueriesService } from './inbox-queries.service.js';
import type { InboxItemResponse } from './inbox.schemas.js';
import { notifyInboxChanged } from './signals/inbox-signals.js';

/**
 * Marking the in-app inbox (R50): a recipient reads and acknowledges only their own items (R12). Reading or
 * acknowledging stops the item's escalation (R18). Another recipient's item is a 404.
 */
@Injectable()
export class InboxService {
  private readonly db: NotificationDatabase;
  private readonly clock: Clock;
  private readonly queries: InboxQueriesService;

  constructor(
    @InjectDatabase() db: NotificationDatabase,
    @Inject(CLOCK) clock: Clock,
    @Inject(InboxQueriesService) queries: InboxQueriesService,
  ) {
    this.db = db;
    this.clock = clock;
    this.queries = queries;
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
      await notifyInboxChanged(tx, recipientId);
      const marked = await this.queries.findItem(tx, owned);
      if (!marked) throw new NotFoundException('No inbox item with this id');
      return marked;
    });
  }
}
