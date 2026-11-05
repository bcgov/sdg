import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';

import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import { deliveries, deliveryAttempts, inboxItems, notifications } from '../database/schema/index.js';
import { historyConditions } from './history.filters.js';
import {
  iso,
  type AttemptResponse,
  type DeliveryResponse,
  type HistoryInboxItem,
  type HistoryQuery,
  type NotificationDetail,
  type NotificationPage,
  type NotificationSummary,
  type RollUp,
} from './history.schemas.js';

type NotificationRow = typeof notifications.$inferSelect;
type DeliveryRow = typeof deliveries.$inferSelect;
type AttemptRow = typeof deliveryAttempts.$inferSelect;
type InboxItemRow = typeof inboxItems.$inferSelect;

const emptyRollUp = (): RollUp => ({
  total: 0,
  scheduled: 0,
  sending: 0,
  delivered: 0,
  failed: 0,
  cancelled: 0,
  skipped: 0,
});

function toSummary(row: NotificationRow, rollUp: RollUp): NotificationSummary {
  return {
    id: row.id,
    senderId: row.senderId,
    credentialId: row.credentialId,
    type: row.typeKey,
    audienceKind: row.audienceKind,
    topicId: row.topicId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    expandedAt: iso(row.expandedAt),
    rollUp,
  };
}

function toAttempt(row: AttemptRow): AttemptResponse {
  const { attempt, integrationId, integrationVersion, status, error, rendered, createdAt } = row;
  return { attempt, integrationId, integrationVersion, status, error, rendered, createdAt: createdAt.toISOString() };
}

function toDelivery(row: DeliveryRow, attempts: AttemptResponse[]): DeliveryResponse {
  const { id, recipientId, channel, step, contactPointId, address, status, reason } = row;
  const times = { dueAt: iso(row.dueAt), finishedAt: iso(row.finishedAt) };
  return { id, recipientId, channel, step, contactPointId, address, status, reason, ...times, attempts };
}

function toInboxItem(row: InboxItemRow): HistoryInboxItem {
  const { id, recipientId, title, body, actionUrl, language } = row;
  const times = { readAt: iso(row.readAt), acknowledgedAt: iso(row.acknowledgedAt) };
  return { id, recipientId, title, body, actionUrl, language, ...times, createdAt: row.createdAt.toISOString() };
}

/**
 * Delivery history (R12, R43, R55). `senderId` scopes every query to one sender's notifications (a credential's);
 * null reads every sender's (an admin's). Another sender's notification is a 404, never a 403, so its existence
 * stays hidden.
 */
@Injectable()
export class HistoryService {
  private readonly db: NotificationDatabase;

  constructor(@InjectDatabase() db: NotificationDatabase) {
    this.db = db;
  }

  /** Notifications matching every filter given, newest first, a cursor page at a time. */
  async list(senderId: string | null, query: HistoryQuery): Promise<NotificationPage> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(...historyConditions(this.db, senderId, query)))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const rollUps = await this.rollUps(page.map((row) => row.id));
    return {
      items: page.map((row) => toSummary(row, rollUps.get(row.id) ?? emptyRollUp())),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** One notification with its roll-up, every delivery and attempt, and the in-app items it created. */
  async get(senderId: string | null, notificationId: string): Promise<NotificationDetail> {
    const scope = senderId === null ? undefined : eq(notifications.senderId, senderId);
    const [row] = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, notificationId), scope));
    if (!row) throw new NotFoundException('No notification with this id');
    const [rollUps, deliveryRows, attempts, items] = await Promise.all([
      this.rollUps([row.id]),
      this.db
        .select()
        .from(deliveries)
        .where(eq(deliveries.notificationId, row.id))
        .orderBy(asc(deliveries.step), asc(deliveries.createdAt), asc(deliveries.id)),
      this.attemptsByDelivery(row.id),
      this.db
        .select()
        .from(inboxItems)
        .where(eq(inboxItems.notificationId, row.id))
        .orderBy(asc(inboxItems.createdAt), asc(inboxItems.id)),
    ]);
    return {
      ...toSummary(row, rollUps.get(row.id) ?? emptyRollUp()),
      deliveries: deliveryRows.map((delivery) => toDelivery(delivery, attempts.get(delivery.id) ?? [])),
      inboxItems: items.map(toInboxItem),
    };
  }

  /** Each notification's deliveries counted by status (R55). */
  private async rollUps(notificationIds: readonly string[]): Promise<Map<string, RollUp>> {
    const byId = new Map<string, RollUp>();
    if (notificationIds.length === 0) return byId;
    const counts = await this.db
      .select({ notificationId: deliveries.notificationId, status: deliveries.status, count: count() })
      .from(deliveries)
      .where(inArray(deliveries.notificationId, [...notificationIds]))
      .groupBy(deliveries.notificationId, deliveries.status);
    for (const { notificationId, status, count: n } of counts) {
      const rollUp = byId.get(notificationId) ?? emptyRollUp();
      rollUp[status] += n;
      rollUp.total += n;
      byId.set(notificationId, rollUp);
    }
    return byId;
  }

  private async attemptsByDelivery(notificationId: string): Promise<Map<string, AttemptResponse[]>> {
    const rows = await this.db
      .select({ attempt: deliveryAttempts })
      .from(deliveryAttempts)
      .innerJoin(deliveries, eq(deliveries.id, deliveryAttempts.deliveryId))
      .where(eq(deliveries.notificationId, notificationId))
      .orderBy(asc(deliveryAttempts.attempt), asc(deliveryAttempts.createdAt));
    const byDelivery = new Map<string, AttemptResponse[]>();
    for (const { attempt } of rows) {
      const list = byDelivery.get(attempt.deliveryId) ?? [];
      list.push(toAttempt(attempt));
      byDelivery.set(attempt.deliveryId, list);
    }
    return byDelivery;
  }
}
