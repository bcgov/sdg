import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';

import type { TopicResponse } from '../catalog/catalog.schemas.js';
import { TopicsService } from '../catalog/topics.service.js';
import { InjectDatabase, type DbOrTx, type NotificationDatabase } from '../database/database.module.js';
import { topics, topicSubscriptions } from '../database/schema/index.js';

/**
 * The current subscribers of a topic as a subquery, for set-based audience expansion (KTD14):
 * `INSERT … SELECT … WHERE recipient_id IN (subscribersQuery(tx, topicId))`.
 */
export function subscribersQuery(db: DbOrTx, topicId: string) {
  return db
    .select({ recipientId: topicSubscriptions.recipientId })
    .from(topicSubscriptions)
    .where(eq(topicSubscriptions.topicId, topicId));
}

/**
 * Topic subscriptions (R17): recipients subscribe and unsubscribe themselves where the topic allows it, and senders
 * subscribe recipients to topics they may broadcast to.
 */
@Injectable()
export class SubscriptionsService {
  private readonly db: NotificationDatabase;
  private readonly topics: TopicsService;

  constructor(@InjectDatabase() db: NotificationDatabase, @Inject(TopicsService) topicsService: TopicsService) {
    this.db = db;
    this.topics = topicsService;
  }

  /** The topics the recipient is subscribed to, by key. */
  async listOwn(recipientId: string): Promise<TopicResponse[]> {
    const rows = await this.db
      .select({
        id: topics.id,
        senderId: topics.senderId,
        key: topics.key,
        name: topics.name,
        selfSubscribe: topics.selfSubscribe,
      })
      .from(topicSubscriptions)
      .innerJoin(topics, eq(topics.id, topicSubscriptions.topicId))
      .where(eq(topicSubscriptions.recipientId, recipientId))
      .orderBy(asc(topics.key), asc(topics.id));
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      scope: row.senderId === null ? 'platform' : 'sender',
      selfSubscribe: row.selfSubscribe,
    }));
  }

  /** 404 for no topic, 403 when the topic does not let recipients subscribe themselves (R17). */
  async subscribeSelf(recipientId: string, topicId: string): Promise<void> {
    await this.requireSelfSubscribe(topicId);
    await this.db.insert(topicSubscriptions).values({ topicId, recipientId }).onConflictDoNothing();
  }

  async unsubscribeSelf(recipientId: string, topicId: string): Promise<void> {
    await this.requireSelfSubscribe(topicId);
    await this.unsubscribe(recipientId, topicId);
  }

  /** Subscribes a recipient for a sender: 404 unless the sender may broadcast to the topic (R15–R17). */
  async subscribeBySender(senderId: string, topicId: string, recipientId: string): Promise<void> {
    await this.requireBroadcastable(senderId, topicId);
    await this.db.insert(topicSubscriptions).values({ topicId, recipientId }).onConflictDoNothing();
  }

  /** 404 unless the sender may broadcast to the topic. */
  async requireBroadcastable(senderId: string, topicId: string): Promise<void> {
    if (!(await this.topics.broadcastable(senderId, topicId))) throw new NotFoundException();
  }

  /** The topic's current subscribers' recipient ids (R30). */
  async subscribers(topicId: string, db: DbOrTx = this.db): Promise<string[]> {
    const rows = await subscribersQuery(db, topicId);
    return rows.map((row) => row.recipientId);
  }

  private async unsubscribe(recipientId: string, topicId: string): Promise<void> {
    await this.db
      .delete(topicSubscriptions)
      .where(and(eq(topicSubscriptions.topicId, topicId), eq(topicSubscriptions.recipientId, recipientId)));
  }

  private async requireSelfSubscribe(topicId: string): Promise<void> {
    const topic = await this.topics.find(topicId);
    if (!topic) throw new NotFoundException();
    if (!topic.selfSubscribe) throw new ForbiddenException('This topic does not let recipients subscribe themselves');
  }
}
