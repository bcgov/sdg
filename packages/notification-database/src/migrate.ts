// Entry point of the notification-database image (dist/migrate.js), run as notification-api's initContainer.
// Exit code 0: every migration is applied. Exit code 1: DATABASE_URL is missing/invalid, or creating the database,
// taking the migration lock or migrating failed.
import { runMigrations } from './run-migrations.js';

process.on('unhandledRejection', (reason) => {
  console.error(
    'notification-database migrate: unhandled rejection',
    reason instanceof Error ? reason.message : reason,
  );
  process.exit(1);
});

try {
  const { target, databaseCreated } = await runMigrations(process.env['DATABASE_URL']);
  if (databaseCreated) console.log(`notification-database migrate: created ${target}`);
  console.log(`notification-database migrate: all migrations applied to ${target}`);
} catch (error) {
  console.error(`notification-database migrate: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
