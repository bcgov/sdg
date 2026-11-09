# @repo/notification-database

notification-api's database: the drizzle schema, the migrations and the migration runner. notification-api (`apps/notification-api`) imports the schema from here and has no schema or migrations of its own.

- **Schema.** Every table is in the Postgres schema `notification` (`src/schema/pg-schema.ts`), in notification-api's own `notification` database. Exports: `.` (schema and `migrationsFolder`), `./schema`, and `./testing` (`migrateTestDatabase`, which applies the migrations to an in-process PGlite database for tests).
- **Migrations.** drizzle-kit migrations in `migrations/`, generated from the schema with `pnpm --filter @repo/notification-database db:generate` (reads `DATABASE_URL` from `.env`; see `.env.example`). drizzle records applied migrations in `drizzle.__drizzle_migrations`. Keep each migration compatible with the previous release, because its pods keep running during a rolling update and after a rollback.
- **Runner.** `runMigrations` (`src/run-migrations.ts`) creates the database when it is missing (the local stack needs that; under PGO it already exists), then applies the pending migrations while holding a session-level `pg_advisory_lock`, so migrators started together apply each migration once. A migrator that waits more than 120 seconds for the lock gives up. Errors name the host and database, never the credentials.
- **Migrator image.** `Dockerfile` builds the `notification-database` image from the repository root (`podman build -f packages/notification-database/Dockerfile .`). Its entry, `dist/migrate.js` (`src/migrate.ts`), reads `DATABASE_URL` and exits 0 when every migration is applied, 1 otherwise. It runs as the initContainer of every notification-api Deployment (`charts/notification-api`) and as compose's `notification-migrate` service. `scripts/images-smoke.sh` checks it, including two migrators at once.

## Test

```sh
pnpm --filter @repo/notification-database test
```

The PGlite, export and `DATABASE_URL` checks always run. The tests that need a real Postgres server (database creation, concurrent runners, the lock's bounded wait) run only when `NOTIFICATION_TEST_DATABASE_URL` names a database whose user may create databases, e.g. the local stack's:

```sh
NOTIFICATION_TEST_DATABASE_URL=postgres://portal:portal@localhost:5432/portal pnpm --filter @repo/notification-database test
```
