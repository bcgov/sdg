// The notification database's tables. Each feature adds its table file here and re-exports it from this barrel,
// then runs `pnpm --filter notification-api db:generate` to write its migration into drizzle/.
// oxlint-disable-next-line unicorn/require-module-specifiers -- a module with no tables yet; U4 adds the first and drops this line.
export {};
