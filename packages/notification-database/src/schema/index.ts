// The notification database's tables, all in the `notification` Postgres schema. Each feature adds its table file
// here and re-exports it from this barrel, then runs `pnpm --filter @repo/notification-database db:generate` to write
// its migration into migrations/.
export * from './callbacks.js';
export * from './catalog.js';
export * from './credentials.js';
export * from './deliveries.js';
export * from './integrations.js';
export * from './notifications.js';
export * from './pg-schema.js';
export * from './recipients.js';
export * from './senders.js';
export * from './templates.js';
export * from './topics.js';
export type * from './value-types.js';
