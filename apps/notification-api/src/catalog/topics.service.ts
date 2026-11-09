import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { topicBroadcastGrants, topics } from '@repo/notification-database';
import { and, asc, eq, inArray, isNotNull, isNull, or, type SQL } from 'drizzle-orm';

import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import { requireSender } from '../senders/require-sender.js';
import type { CreateTopic, PlatformTopicResponse, TopicResponse } from './catalog.schemas.js';

const topicColumns = {
  id: topics.id,
  senderId: topics.senderId,
  key: topics.key,
  name: topics.name,
  selfSubscribe: topics.selfSubscribe,
};

interface TopicRow {
  id: string;
  senderId: string | null;
  key: string;
  name: string;
  selfSubscribe: boolean;
}

/** A topic as callers see it; never which sender owns it or which senders may broadcast. */
function toTopic({ senderId, ...topic }: TopicRow): TopicResponse {
  return { ...topic, scope: senderId === null ? 'platform' : 'sender' };
}

/**
 * Platform topics and their broadcast grants (R15), sender topics (R16), and the broadcast check sends and
 * subscriptions use. A sender sees and broadcasts to its own topics and the platform topics it was granted; any other
 * topic is a 404 to it.
 */
@Injectable()
export class TopicsService {
  private readonly db: NotificationDatabase;

  constructor(@InjectDatabase() db: NotificationDatabase) {
    this.db = db;
  }

  async createPlatform(input: CreateTopic): Promise<PlatformTopicResponse> {
    const topic = await this.insert(null, input);
    return { ...topic, broadcasters: [] };
  }

  async listPlatform(): Promise<PlatformTopicResponse[]> {
    const rows = await this.db
      .select(topicColumns)
      .from(topics)
      .where(isNull(topics.senderId))
      .orderBy(asc(topics.key));
    const broadcasters = await this.broadcastersOf(rows.map((row) => row.id));
    return rows.map((row) => Object.assign(toTopic(row), { broadcasters: broadcasters.get(row.id) ?? [] }));
  }

  async getPlatform(topicId: string): Promise<PlatformTopicResponse> {
    const [[row], broadcasters] = await Promise.all([
      this.db
        .select(topicColumns)
        .from(topics)
        .where(and(eq(topics.id, topicId), isNull(topics.senderId))),
      this.broadcastersOf([topicId]),
    ]);
    if (!row) throw new NotFoundException();
    return { ...toTopic(row), broadcasters: broadcasters.get(topicId) ?? [] };
  }

  /** Grants a sender permission to broadcast to a platform topic (R15). */
  async grantBroadcast(topicId: string, senderId: string): Promise<PlatformTopicResponse> {
    await Promise.all([this.getPlatform(topicId), requireSender(this.db, senderId, 'No sender with this id')]);
    await this.db.insert(topicBroadcastGrants).values({ topicId, senderId }).onConflictDoNothing();
    return this.getPlatform(topicId);
  }

  async revokeBroadcast(topicId: string, senderId: string): Promise<PlatformTopicResponse> {
    await this.getPlatform(topicId);
    await this.db
      .delete(topicBroadcastGrants)
      .where(and(eq(topicBroadcastGrants.topicId, topicId), eq(topicBroadcastGrants.senderId, senderId)));
    return this.getPlatform(topicId);
  }

  /** A topic of the sender's own records, such as one per permit (R16). */
  createForSender(senderId: string, input: CreateTopic): Promise<TopicResponse> {
    return this.insert(senderId, input);
  }

  /** The sender's own topics, then the platform topics it may broadcast to. */
  async listForSender(senderId: string): Promise<TopicResponse[]> {
    const rows = await this.broadcastableQuery(senderId).orderBy(asc(topics.senderId), asc(topics.key));
    return rows.map(toTopic);
  }

  async getForSender(senderId: string, topicId: string): Promise<TopicResponse> {
    const topic = await this.broadcastable(senderId, topicId);
    if (!topic) throw new NotFoundException();
    return topic;
  }

  /**
   * The topic when the sender may broadcast to it, and subscribe recipients to it (R15–R17): its own sender topic, or
   * a platform topic it was granted. Null otherwise, including when the topic does not exist.
   */
  async broadcastable(senderId: string, topicId: string): Promise<TopicResponse | null> {
    const [row] = await this.broadcastableQuery(senderId, eq(topics.id, topicId));
    return row ? toTopic(row) : null;
  }

  /** Any topic by id, with whether recipients may subscribe themselves (R17); null when there is none. */
  async find(topicId: string): Promise<TopicResponse | null> {
    const [row] = await this.db.select(topicColumns).from(topics).where(eq(topics.id, topicId));
    return row ? toTopic(row) : null;
  }

  private broadcastableQuery(senderId: string, filter?: SQL) {
    return this.db
      .select(topicColumns)
      .from(topics)
      .leftJoin(
        topicBroadcastGrants,
        and(eq(topicBroadcastGrants.topicId, topics.id), eq(topicBroadcastGrants.senderId, senderId)),
      )
      .where(and(or(eq(topics.senderId, senderId), isNotNull(topicBroadcastGrants.senderId)), filter));
  }

  /** 409 when the key is taken among platform topics, or within the sender's topics. */
  private async insert(senderId: string | null, { key, name, selfSubscribe }: CreateTopic): Promise<TopicResponse> {
    const [created] = await this.db
      .insert(topics)
      .values({ senderId, key, name, selfSubscribe })
      .onConflictDoNothing()
      .returning(topicColumns);
    if (!created) throw new ConflictException('A topic with this key already exists');
    return toTopic(created);
  }

  private async broadcastersOf(topicIds: readonly string[]): Promise<Map<string, string[]>> {
    const broadcasters = new Map<string, string[]>(topicIds.map((id) => [id, []]));
    if (topicIds.length === 0) return broadcasters;
    const rows = await this.db
      .select({ topicId: topicBroadcastGrants.topicId, senderId: topicBroadcastGrants.senderId })
      .from(topicBroadcastGrants)
      .where(inArray(topicBroadcastGrants.topicId, [...topicIds]))
      .orderBy(asc(topicBroadcastGrants.createdAt), asc(topicBroadcastGrants.senderId));
    for (const row of rows) broadcasters.get(row.topicId)?.push(row.senderId);
    return broadcasters;
  }
}
