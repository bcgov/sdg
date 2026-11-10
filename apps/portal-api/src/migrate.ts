// Entry point of portal-api's sessions migration (dist/migrate.js), run as an initContainer with the portal login.
// Exit code 0: every sessions migration is applied in the portal schema. Exit code 1: DATABASE_URL is missing or
// invalid, or migrating failed (the message names the host and database, never the credentials).
import { runSessionMigrations } from '@repo/bff-core/migrations';

import { SESSION_SCHEMA } from './bff/portal-session.js';

process.on('unhandledRejection', (reason) => {
  console.error('portal-api migrate: unhandled rejection', reason instanceof Error ? reason.message : reason);
  process.exit(1);
});

try {
  await runSessionMigrations(process.env['DATABASE_URL'], { migrationsSchema: SESSION_SCHEMA });
  console.log('portal-api migrate: all sessions migrations applied');
} catch (error) {
  console.error(`portal-api migrate: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
