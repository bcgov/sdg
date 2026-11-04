import type { DbOrTx } from '../database/database.module.js';
import type { notifications } from '../database/schema/index.js';
import type { RecipientsService } from '../recipients/recipients.service.js';
import type { Audience, SendRecipient } from './send.schemas.js';

/** The audience columns of a notification row. */
export type AudienceColumns = Pick<typeof notifications.$inferInsert, 'audienceKind' | 'recipientIds' | 'topicId'>;

/**
 * The recipient id for one named recipient, inside the accept transaction (R27): a user is created or found and
 * registered for the sender with the sender's contact points (AE16); an address becomes or matches the sender's
 * address-only recipient (AE6); a system was resolved by validation.
 */
function recipientId(
  recipients: RecipientsService,
  senderId: string,
  recipient: SendRecipient,
  systemId: string | undefined,
  tx: DbOrTx,
): Promise<string> {
  if (recipient.kind === 'user') {
    const { issuer, subject, contactPoints } = recipient;
    return recipients.upsertUserForSender(senderId, { issuer, subject }, contactPoints, tx);
  }
  if (recipient.kind === 'address') {
    const { kind: _kind, ...address } = recipient;
    return recipients.upsertAddressRecipient(senderId, address, tx);
  }
  if (systemId === undefined) throw new Error('A system recipient reached the accept transaction unresolved');
  return Promise.resolve(systemId);
}

/**
 * The audience spec the workers expand (R30, R31): recipient ids for an explicit list, deduplicated in the order the
 * send named them; the topic; or the sender's whole audience. The upserts run one after another on the transaction's
 * connection.
 */
export async function audienceColumns(
  recipients: RecipientsService,
  senderId: string,
  audience: Audience,
  systems: ReadonlyMap<number, string>,
  tx: DbOrTx,
): Promise<AudienceColumns> {
  if (audience.kind === 'topic') return { audienceKind: 'topic', recipientIds: null, topicId: audience.topicId };
  if (audience.kind === 'everyone') return { audienceKind: 'everyone', recipientIds: null, topicId: null };
  const ids: string[] = [];
  for (const [index, recipient] of audience.recipients.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- one connection: the upserts are ordered, not concurrent.
    ids.push(await recipientId(recipients, senderId, recipient, systems.get(index), tx));
  }
  return { audienceKind: 'recipients', recipientIds: [...new Set(ids)], topicId: null };
}
