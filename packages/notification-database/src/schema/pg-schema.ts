import { pgSchema, type PgSchema } from 'drizzle-orm/pg-core';

/** The Postgres schema every notification table lives in. The app user owns it, so no `public` rights are needed. */
export const NOTIFICATION_SCHEMA = 'notification';

/** Declares the tables in {@link NOTIFICATION_SCHEMA}. Exported so drizzle-kit creates the schema in the migration. */
export const notificationSchema: PgSchema<typeof NOTIFICATION_SCHEMA> = pgSchema(NOTIFICATION_SCHEMA);
