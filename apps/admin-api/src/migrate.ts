import { runSessionMigrations } from '@repo/bff-core/migrations';

import { SESSION_SCHEMA } from './bff/admin-session.js';

process.on('unhandledRejection', (reason) => {
  console.error('admin-api migrate: unhandled rejection', reason instanceof Error ? reason.message : reason);
  process.exit(1);
});

try {
  await runSessionMigrations(process.env['DATABASE_URL'], { migrationsSchema: SESSION_SCHEMA });
  console.log('admin-api migrate: all sessions migrations applied');
} catch (error) {
  console.error(`admin-api migrate: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
