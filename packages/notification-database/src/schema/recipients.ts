import { sql } from 'drizzle-orm';
import { check, index, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import type {
  $Type,
  HasDefault,
  NotificationTable,
  NotNull,
  TextArrayColumn,
  TextColumn,
  TextOf,
  TextPrimaryKey,
  TimestamptzColumn,
  TimestamptzDefaultNow,
  UuidColumn,
  UuidPrimaryKey,
  UuidReference,
} from './column-types.js';
import { notificationSchema } from './pg-schema.js';
import { senders } from './senders.js';
import { topics } from './topics.js';
import type { Channel } from './value-types.js';

/**
 * `user`: a person, keyed by IdP issuer + subject across senders (R27, R32). `address`: a raw address one sender
 * sent to, deduplicated by normalized address within that sender (R27, KTD17). `system`: a system a sender registered
 * with webhook endpoints (R33).
 */
export type RecipientKind = 'user' | 'address' | 'system';

/** Where a contact point came from (R35): the IdP email seed, the user, or a sender. */
export type ContactPointSource = 'idp' | 'user' | 'sender';

export type RecipientsTable = NotificationTable<
  'recipients',
  {
    id: UuidPrimaryKey;
    kind: TextOf<RecipientKind>;
    issuer: TextColumn;
    subject: TextColumn;
    senderId: UuidColumn;
    channel: $Type<TextColumn, Channel>;
    address: TextColumn;
    reference: TextColumn;
    systemId: TextColumn;
    claimedAt: TimestamptzColumn;
    language: TextColumn;
    timeZone: TextColumn;
    quietHoursStart: TextColumn;
    quietHoursEnd: TextColumn;
    channelsOff: HasDefault<NotNull<$Type<TextArrayColumn, Channel[]>>>;
    createdAt: TimestamptzDefaultNow;
    updatedAt: TimestamptzDefaultNow;
  }
>;

/**
 * Every recipient. Each kind has its own unique key, and every write is an upsert on it, so racing writes resolve to
 * one row. Users carry their settings (R37–R40); address-only recipients carry the language and timezone their
 * sender set (R39).
 */
export const recipients: RecipientsTable = notificationSchema.table(
  'recipients',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().$type<RecipientKind>().notNull(),
    /** User: the IdP issuer and subject. */
    issuer: text(),
    subject: text(),
    /** Address-only and system: the sender the recipient belongs to. */
    senderId: uuid().references(() => senders.id, { onDelete: 'cascade' }),
    /** Address-only: the channel and normalized address. */
    channel: text().$type<Channel>(),
    address: text(),
    /** Address-only: the sender's own reference for the person, e.g. a form id (F2). */
    reference: text(),
    /** System: the sender's id for the system. */
    systemId: text(),
    /** User: when their first relayed call claimed the recipient and seeded the IdP email, which happens once (R32). */
    claimedAt: timestamp({ withTimezone: true }),
    /** A BCP 47 tag; null means the type's default language (R39). */
    language: text(),
    /** An IANA zone; null means DEFAULT_TIMEZONE (R39). */
    timeZone: text(),
    /** User: local `HH:MM` times; both set or both null (R40). */
    quietHoursStart: text(),
    quietHoursEnd: text(),
    /** Switchable channels the user turned off (R37). */
    channelsOff: text()
      .array()
      .$type<Channel[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('recipients_issuer_subject_key').on(table.issuer, table.subject),
    unique('recipients_sender_id_channel_address_key').on(table.senderId, table.channel, table.address),
    unique('recipients_sender_id_system_id_key').on(table.senderId, table.systemId),
    check(
      'recipients_kind_check',
      sql`(kind = 'user' AND issuer IS NOT NULL AND subject IS NOT NULL AND sender_id IS NULL)
        OR (kind = 'address' AND sender_id IS NOT NULL AND channel IS NOT NULL AND address IS NOT NULL)
        OR (kind = 'system' AND sender_id IS NOT NULL AND system_id IS NOT NULL)`,
    ),
  ],
);

export type RecipientRegistrationsTable = NotificationTable<
  'recipient_registrations',
  { senderId: UuidReference; recipientId: UuidReference; createdAt: TimestamptzDefaultNow }
>;

/** A user a sender registered, by pre-registration or by sending to them (R27, R33): part of its "everyone" (R30). */
export const recipientRegistrations: RecipientRegistrationsTable = notificationSchema.table(
  'recipient_registrations',
  {
    senderId: uuid()
      .notNull()
      .references(() => senders.id, { onDelete: 'cascade' }),
    recipientId: uuid()
      .notNull()
      .references(() => recipients.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.senderId, table.recipientId] }),
    index('recipient_registrations_recipient_id_idx').on(table.recipientId),
  ],
);

export type ContactPointsTable = NotificationTable<
  'contact_points',
  {
    id: UuidPrimaryKey;
    recipientId: UuidReference;
    channel: TextOf<Exclude<Channel, 'in-app'>>;
    address: NotNull<TextColumn>;
    ownerSenderId: UuidColumn;
    source: TextOf<ContactPointSource>;
    verifiedAt: TimestamptzColumn;
    signingSecret: TextColumn;
    createdAt: TimestamptzDefaultNow;
    updatedAt: TimestamptzDefaultNow;
  }
>;

/**
 * An address a recipient is reached at on one channel (R34). A user-owned point (no owner sender) is usable once
 * verified; a sender-owned point is trusted as given, but only for that sender's deliveries, and the user never sees
 * it (R33, R35).
 */
export const contactPoints: ContactPointsTable = notificationSchema.table(
  'contact_points',
  {
    id: uuid().primaryKey().defaultRandom(),
    recipientId: uuid()
      .notNull()
      .references(() => recipients.id, { onDelete: 'cascade' }),
    channel: text().$type<Exclude<Channel, 'in-app'>>().notNull(),
    /** Email: normalized (KTD17). Webhook: the endpoint URL. */
    address: text().notNull(),
    /** Null: the user's own. Otherwise the sender that supplied it. */
    ownerSenderId: uuid().references(() => senders.id, { onDelete: 'cascade' }),
    source: text().$type<ContactPointSource>().notNull(),
    /** Null while a user-owned address awaits confirmation (KTD15). */
    verifiedAt: timestamp({ withTimezone: true }),
    /** Webhook: the endpoint's Standard Webhooks secret (KTD10), sealed at (id, `signingSecret`). */
    signingSecret: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('contact_points_recipient_id_channel_owner_sender_id_address_key')
      .on(table.recipientId, table.channel, table.ownerSenderId, table.address)
      .nullsNotDistinct(),
  ],
);

export type VerificationTokensTable = NotificationTable<
  'verification_tokens',
  {
    tokenHash: TextPrimaryKey;
    contactPointId: UuidReference;
    address: NotNull<TextColumn>;
    expiresAt: NotNull<TimestamptzColumn>;
    usedAt: TimestamptzColumn;
    createdAt: TimestamptzDefaultNow;
  }
>;

/** A confirmation link's token (KTD15): stored as its SHA-256 hash, single use, valid for 24 hours. */
export const verificationTokens: VerificationTokensTable = notificationSchema.table(
  'verification_tokens',
  {
    tokenHash: text().primaryKey(),
    contactPointId: uuid()
      .notNull()
      .references(() => contactPoints.id, { onDelete: 'cascade' }),
    /** The address the link was sent to: it confirms only that address, not one the point was edited to since. */
    address: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('verification_tokens_contact_point_id_idx').on(table.contactPointId)],
);

export type ConfirmationSendsTable = NotificationTable<
  'confirmation_sends',
  { id: UuidPrimaryKey; recipientId: UuidReference; address: NotNull<TextColumn>; sentAt: TimestamptzDefaultNow }
>;

/** One confirmation email sent: the rows R36's limits count (KTD15). */
export const confirmationSends: ConfirmationSendsTable = notificationSchema.table(
  'confirmation_sends',
  {
    id: uuid().primaryKey().defaultRandom(),
    recipientId: uuid()
      .notNull()
      .references(() => recipients.id, { onDelete: 'cascade' }),
    /** The normalized target address. */
    address: text().notNull(),
    sentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('confirmation_sends_recipient_id_sent_at_idx').on(table.recipientId, table.sentAt),
    index('confirmation_sends_address_sent_at_idx').on(table.address, table.sentAt),
  ],
);

export type TopicSubscriptionsTable = NotificationTable<
  'topic_subscriptions',
  { topicId: UuidReference; recipientId: UuidReference; createdAt: TimestamptzDefaultNow }
>;

/** A recipient's subscription to a topic, by themselves or by a sender that may broadcast to it (R17). */
export const topicSubscriptions: TopicSubscriptionsTable = notificationSchema.table(
  'topic_subscriptions',
  {
    topicId: uuid()
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    recipientId: uuid()
      .notNull()
      .references(() => recipients.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.topicId, table.recipientId] }),
    index('topic_subscriptions_recipient_id_idx').on(table.recipientId),
  ],
);
