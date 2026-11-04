// The notification database's tables. Each feature adds its table file here and re-exports it from this barrel,
// then runs `pnpm --filter notification-api db:generate` to write its migration into drizzle/.
export * from './credentials.js';
export * from './senders.js';
