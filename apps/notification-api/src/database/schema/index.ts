// The notification database's tables. Each feature adds its table file here and re-exports it from this barrel,
// then runs `pnpm --filter notification-api db:generate` to write its migration into drizzle/.
export * from './catalog.js';
export * from './credentials.js';
export * from './integrations.js';
export * from './recipients.js';
export * from './senders.js';
export * from './templates.js';
export * from './topics.js';
