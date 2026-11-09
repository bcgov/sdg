import { foreignKey, index, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import type {
  NotificationTable,
  NotNull,
  TextColumn,
  TimestamptzDefaultNow,
  UuidPrimaryKey,
  UuidReference,
} from './column-types.js';
import { notificationSchema } from './pg-schema.js';
import { senders, senderTypeGrants } from './senders.js';

export type CredentialsTable = NotificationTable<
  'credentials',
  {
    id: UuidPrimaryKey;
    senderId: UuidReference;
    clientId: NotNull<TextColumn>;
    createdAt: TimestamptzDefaultNow;
  }
>;

/** A Keycloak service-account client linked by client id to exactly one sender (R8). */
export const credentials: CredentialsTable = notificationSchema.table(
  'credentials',
  {
    id: uuid().primaryKey().defaultRandom(),
    senderId: uuid()
      .notNull()
      .references(() => senders.id, { onDelete: 'cascade' }),
    clientId: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('credentials_client_id_key').on(table.clientId),
    index('credentials_sender_id_idx').on(table.senderId),
    // The target of credential_type_scopes' (credential, sender) key.
    unique('credentials_id_sender_id_key').on(table.id, table.senderId),
  ],
);

export type CredentialTypeScopesTable = NotificationTable<
  'credential_type_scopes',
  {
    credentialId: UuidReference;
    senderId: UuidReference;
    typeKey: NotNull<TextColumn>;
  }
>;

/**
 * A type a credential may send. Keyed to the sender's grant, so a scope is always a subset of the sender's grants and
 * revoking a grant deletes it from every credential's scope in the same statement (R8, R9).
 */
export const credentialTypeScopes: CredentialTypeScopesTable = notificationSchema.table(
  'credential_type_scopes',
  {
    credentialId: uuid().notNull(),
    senderId: uuid().notNull(),
    typeKey: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.credentialId, table.typeKey] }),
    foreignKey({
      name: 'credential_type_scopes_credential_fk',
      columns: [table.credentialId, table.senderId],
      foreignColumns: [credentials.id, credentials.senderId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'credential_type_scopes_grant_fk',
      columns: [table.senderId, table.typeKey],
      foreignColumns: [senderTypeGrants.senderId, senderTypeGrants.typeKey],
    }).onDelete('cascade'),
  ],
);
