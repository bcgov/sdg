// `pnpm --filter notification-api db:migrate`: creates the `notification` database (the name DATABASE_URL gives)
// when it is missing, then applies drizzle/. Exit code 0: every migration is applied. 1: DATABASE_URL is
// missing or invalid, or creating or migrating failed. Reads apps/notification-api/.env when present.
import { existsSync } from 'node:fs';

import { runMigrations } from '../src/database/run-migrations.ts';

process.on('unhandledRejection', (reason) => {
  console.error('notification-api migrate: unhandled rejection', reason instanceof Error ? reason.message : reason);
  process.exit(1);
});

if (existsSync('.env')) process.loadEnvFile('.env');

try {
  const { target, databaseCreated } = await runMigrations(process.env['DATABASE_URL']);
  if (databaseCreated) console.log(`notification-api migrate: created ${target}`);
  console.log(`notification-api migrate: all migrations applied to ${target}`);
} catch (error) {
  console.error(`notification-api migrate: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
