import { defineConfig } from 'drizzle-kit';

// Generates the sessions migrations only (`pnpm db:generate`); each BFF applies them with runSessionMigrations.
// The table is unqualified, so it lands in the migrating login's own schema (KTD8, KTD9).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/session/sessions.schema.ts',
  out: './migrations',
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
