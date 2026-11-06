import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import {
  InjectDatabase,
  type NotificationDatabase,
  type NotificationTransaction,
} from '../database/database.module.js';
import { inboxItems, notificationRecipients } from '../database/schema/index.js';
import { cancelPendingSteps } from '../delivery/escalation.js';
import { CLOCK, type Clock } from '../delivery/settings.js';
import type { ReadAll } from './inbox.schemas.js';

/**
 * "Mark all as read" (R20, KTD9): reads every unread item of the caller's that is committed when it runs, loaded on
 * screen or not, and stops each one's escalation as reading one does (R19). It takes no client bound, so an item whose
 * planning commits after it stays unread (AE5).
 */
@Injectable()
export class ReadAllService {
  private readonly db: NotificationDatabase;
  private readonly clock: Clock;

  constructor(@InjectDatabase() db: NotificationDatabase, @Inject(CLOCK) clock: Clock) {
    this.db = db;
    this.clock = clock;
  }

  async readAll(recipientId: string): Promise<ReadAll> {
    const now = this.clock.now();
    const marked = await this.db.transaction((tx) => markAllRead(tx, recipientId, now));
    return { marked };
  }
}

/** Marks the recipient's unread items read in the caller's transaction and resolves how many it marked. */
async function markAllRead(tx: NotificationTransaction, recipientId: string, now: Date): Promise<number> {
  const unread = tx
    .select({ id: inboxItems.notificationRecipientId })
    .from(inboxItems)
    .where(and(eq(inboxItems.recipientId, recipientId), isNull(inboxItems.readAt)));
  // The lock the delivery worker takes to record a step (escalation.ts), taken in id order so two of these for one
  // recipient can't deadlock.
  const locked = await tx
    .select({ id: notificationRecipients.id })
    .from(notificationRecipients)
    .where(inArray(notificationRecipients.id, unread))
    .orderBy(asc(notificationRecipients.id))
    .for('update');
  if (locked.length === 0) return 0;
  // Only rows still unread: one read alone while this waited for its lock keeps its first read time (R21).
  const marked = await tx
    .update(inboxItems)
    .set({ readAt: now })
    .where(
      and(
        eq(inboxItems.recipientId, recipientId),
        isNull(inboxItems.readAt),
        inArray(
          inboxItems.notificationRecipientId,
          locked.map((row) => row.id),
        ),
      ),
    )
    .returning({ notificationRecipientId: inboxItems.notificationRecipientId });
  await Promise.all(marked.map((row) => cancelPendingSteps(tx, row.notificationRecipientId, 'read', now)));
  return marked.length;
}
