import { Injectable, NotFoundException } from '@nestjs/common';
import { inboxItems, notifications } from '@repo/notification-database';
import { and, count, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { convert, type HtmlToTextOptions } from 'html-to-text';
import { z } from 'zod';

import { InjectDatabase, type DbOrTx, type NotificationDatabase } from '../database/database.module.js';
import { inboxItemContent } from '../history/history.service.js';
import { afterCursor, toPage } from '../http/pagination.js';
import type { InboxItemResponse, InboxPage, InboxQuery, UnreadCount } from './inbox.schemas.js';

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

/** The longest excerpt, its ellipsis included. */
const EXCERPT_LENGTH = 140;

/** Text only: no link targets or images, headings in their own case. */
const PLAIN_TEXT: HtmlToTextOptions = {
  wordwrap: false,
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
    ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((selector) => ({ selector, options: { uppercase: false } })),
  ],
};

/** The sanitized HTML body as one line of plain text, cut before a space with an ellipsis when too long (R5). */
function excerptOf(body: string | null): string | null {
  if (body === null) return null;
  const text = convert(body, PLAIN_TEXT).replace(/\s+/g, ' ').trim();
  if (text.length <= EXCERPT_LENGTH) return text;
  const space = text.lastIndexOf(' ', EXCERPT_LENGTH - 1);
  return `${text.slice(0, space > 0 ? space : EXCERPT_LENGTH - 1)}…`;
}

function toItem(row: ItemRow): InboxItemResponse {
  const { id, notificationId, type } = row;
  return { id, notificationId, type, ...inboxItemContent(row), excerpt: excerptOf(row.body) };
}

const NOT_FOUND = 'No inbox item for this notification';

/**
 * What a recipient reads of their own in-app inbox (R50, KTD2): the list, unread or all, the unread count, and one
 * item by its notification id. Another recipient's item is as missing as an unknown one (R18).
 */
@Injectable()
export class InboxQueriesService {
  private readonly db: NotificationDatabase;

  constructor(@InjectDatabase() db: NotificationDatabase) {
    this.db = db;
  }

  /** The recipient's items, or only the unread ones, newest first, a cursor page at a time. */
  async list(recipientId: string, { cursor, limit, unread }: InboxQuery): Promise<InboxPage> {
    const rows = await this.selectItems(
      this.db,
      and(
        eq(inboxItems.recipientId, recipientId),
        unread === true ? isNull(inboxItems.readAt) : undefined,
        afterCursor(inboxItems, cursor),
      ),
    )
      .orderBy(desc(inboxItems.createdAt), desc(inboxItems.id))
      .limit(limit + 1);
    const { page, nextCursor } = toPage(rows, limit);
    return { items: page.map(toItem), nextCursor };
  }

  /** How many of the recipient's items are unread (R2). */
  async unreadCount(recipientId: string): Promise<UnreadCount> {
    const [row] = await this.db
      .select({ unread: count() })
      .from(inboxItems)
      .where(and(eq(inboxItems.recipientId, recipientId), isNull(inboxItems.readAt)));
    return { unread: row?.unread ?? 0 };
  }

  /** The recipient's item for a notification, unchanged; 404 for a malformed, unknown or someone else's id (R18). */
  async byNotification(recipientId: string, notificationId: string): Promise<InboxItemResponse> {
    if (!z.uuid().safeParse(notificationId).success) throw new NotFoundException(NOT_FOUND);
    const item = await this.findItem(
      this.db,
      and(eq(inboxItems.notificationId, notificationId), eq(inboxItems.recipientId, recipientId)),
    );
    if (!item) throw new NotFoundException(NOT_FOUND);
    return item;
  }

  /** The first item matching `where`, read through `db` (a transaction's, when marking). */
  async findItem(db: DbOrTx, where: SQL | undefined): Promise<InboxItemResponse | undefined> {
    const [row] = await this.selectItems(db, where);
    return row && toItem(row);
  }

  private selectItems(db: DbOrTx, where: SQL | undefined) {
    return db
      .select(itemColumns)
      .from(inboxItems)
      .innerJoin(notifications, eq(notifications.id, inboxItems.notificationId))
      .where(where);
  }
}
