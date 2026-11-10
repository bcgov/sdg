// Entry point of the database image (dist/migrate.js), run as an initContainer with the core login.
// Exit code 0: every migration is applied. Exit code 1: DATABASE_URL is missing/invalid or migrating failed.
import { runMigrations } from './run-migrations.js';

process.on('unhandledRejection', (reason) => {
  console.error('database migrate: unhandled rejection', reason instanceof Error ? reason.message : reason);
  process.exit(1);
});

try {
  await runMigrations(process.env['DATABASE_URL']);
  console.log('database migrate: all migrations applied');
} catch (error) {
  console.error(`database migrate: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
