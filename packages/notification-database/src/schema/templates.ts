import { integer, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { notificationTypes } from './catalog.js';
import type {
  IntegerColumn,
  JsonbOf,
  NotificationTable,
  NotNull,
  TextArrayColumn,
  TextColumn,
  TextOf,
  TimestamptzDefaultNow,
  UuidPrimaryKey,
} from './column-types.js';
import { notificationSchema } from './pg-schema.js';
import type { Channel } from './value-types.js';

export type TemplateVersionsTable = NotificationTable<
  'template_versions',
  {
    id: UuidPrimaryKey;
    typeKey: NotNull<TextColumn>;
    channel: TextOf<Channel>;
    language: NotNull<TextColumn>;
    version: NotNull<IntegerColumn>;
    parts: JsonbOf<Record<string, string>>;
    references: NotNull<TextArrayColumn>;
    createdAt: TimestamptzDefaultNow;
  }
>;

/**
 * One immutable version of a type's template for a channel and language (R21, R25). Saving creates the next version;
 * none is ever updated or deleted, so a notification pinned to a version id (KTD7) always renders with it.
 */
export const templateVersions: TemplateVersionsTable = notificationSchema.table(
  'template_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    typeKey: text()
      .notNull()
      .references(() => notificationTypes.key),
    channel: text().$type<Channel>().notNull(),
    /** A canonical BCP 47 tag, such as `en-CA`. */
    language: text().notNull(),
    version: integer().notNull(),
    /** The channel's template parts (notification-api's `src/channels/channels.ts`) by name: Liquid source text. */
    parts: jsonb().$type<Record<string, string>>().notNull(),
    /** The layouts and partials the parts name directly, found by static analysis when saved. */
    references: text().array().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('template_versions_type_key_channel_language_version_key').on(
      table.typeKey,
      table.channel,
      table.language,
      table.version,
    ),
  ],
);

export type FragmentKind = 'layout' | 'partial';

export type FragmentVersionsTable = NotificationTable<
  'template_fragment_versions',
  {
    id: UuidPrimaryKey;
    kind: TextOf<FragmentKind>;
    name: NotNull<TextColumn>;
    version: NotNull<IntegerColumn>;
    source: NotNull<TextColumn>;
    references: NotNull<TextArrayColumn>;
    createdAt: TimestamptzDefaultNow;
  }
>;

/**
 * One immutable version of an admin-defined layout or partial (R22). Layouts and partials share one name space,
 * since templates name both the same way (`{% layout "name" %}`, `{% include "name" %}`), and are versioned and
 * pinned like templates (KTD7).
 */
export const fragmentVersions: FragmentVersionsTable = notificationSchema.table(
  'template_fragment_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().$type<FragmentKind>().notNull(),
    name: text().notNull(),
    version: integer().notNull(),
    source: text().notNull(),
    /** The layouts and partials the source names directly. */
    references: text().array().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('template_fragment_versions_name_version_key').on(table.name, table.version)],
);
