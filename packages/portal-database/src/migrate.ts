// Entry point of the portal-database image (dist/migrate.js), run as portal-api's initContainer.
// Exit code 0: every migration is applied. Exit code 1: DATABASE_URL is missing/invalid or migrating failed.
import { runMigrations } from './run-migrations.js';

process.on('unhandledRejection', (reason) => {
  console.error('portal-database migrate: unhandled rejection', reason instanceof Error ? reason.message : reason);
  process.exit(1);
});

try {
  await runMigrations(process.env['DATABASE_URL']);
  console.log('portal-database migrate: all migrations applied');
} catch (error) {
  console.error(`portal-database migrate: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
