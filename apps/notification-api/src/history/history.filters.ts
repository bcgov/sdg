import { and, eq, exists, or, sql, type SQL } from 'drizzle-orm';

import type { NotificationDatabase } from '../database/database.module.js';
import { deliveries, notificationRecipients, notifications, recipients } from '../database/schema/index.js';
import { normalizeAddress } from '../recipients/normalize.js';
import type { HistoryQuery } from './history.schemas.js';

/**
 * Whether the notification went to a recipient matching `condition` (on `recipients`): a recipient fixed at expansion,
 * or one an explicit send named, so an accepted notification is findable before a worker expands it.
 */
function toRecipient(db: NotificationDatabase, condition: SQL): SQL {
  const expanded = db
    .select({ id: notificationRecipients.id })
    .from(notificationRecipients)
    .innerJoin(recipients, eq(recipients.id, notificationRecipients.recipientId))
    .where(and(eq(notificationRecipients.notificationId, notifications.id), condition));
  const named = db
    .select({ id: recipients.id })
    .from(recipients)
    .where(and(sql`${recipients.id} = ANY(${notifications.recipientIds})`, condition));
  return or(exists(expanded), exists(named)) ?? sql`false`;
}

/** An address delivered to (a user's own included, Key Decision on R43), or of an address-only recipient (F2). */
function toAddress(db: NotificationDatabase, channel: HistoryQuery['channel'], raw: string): SQL {
  const address = normalizeAddress(channel, raw);
  const delivered = db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.notificationId, notifications.id),
        eq(deliveries.channel, channel),
        eq(deliveries.address, address),
      ),
    );
  const addressOnly = and(
    eq(recipients.kind, 'address'),
    eq(recipients.channel, channel),
    eq(recipients.address, address),
  );
  return or(exists(delivered), toRecipient(db, addressOnly ?? sql`false`)) ?? sql`false`;
}

/** The conditions on `notifications` for a history query (R12, R43): the sender's own, or every sender's for admins. */
export function historyConditions(db: NotificationDatabase, senderId: string | null, query: HistoryQuery): SQL[] {
  const conditions: SQL[] = [];
  if (senderId !== null) conditions.push(eq(notifications.senderId, senderId));
  if (query.recipientId !== undefined) conditions.push(toRecipient(db, eq(recipients.id, query.recipientId)));
  if (query.address !== undefined) conditions.push(toAddress(db, query.channel, query.address));
  if (query.reference !== undefined) {
    const referenced = and(eq(recipients.kind, 'address'), eq(recipients.reference, query.reference));
    conditions.push(toRecipient(db, referenced ?? sql`false`));
  }
  if (query.cursor !== undefined) {
    conditions.push(
      sql`(${notifications.createdAt}, ${notifications.id}) < (SELECT c.created_at, c.id FROM notifications c WHERE c.id = ${query.cursor})`,
    );
  }
  return conditions;
}
