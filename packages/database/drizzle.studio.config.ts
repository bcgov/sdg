import { existsSync } from 'node:fs';

import { defineConfig } from 'drizzle-kit';

if (existsSync('.env')) process.loadEnvFile('.env');

// Studio only (`pnpm db:studio`). Each service login reaches only its own schema (dev-postgres/init-roles.sql), so
// Studio, which shows whatever its connection can read, connects as the local compose superuser to see core, portal
// and console together. Local only: never point it at a shared environment.
const url = process.env['STUDIO_DATABASE_URL'];
if (!url) {
  throw new Error('STUDIO_DATABASE_URL is not set. Copy it from packages/database/.env.example to .env, or export it.');
}

export default defineConfig({
  dialect: 'postgresql',
  // Relations and defaults for the core tables; Studio introspects every schema, including those it has no files for.
  schema: './src/schema/index.ts',
  casing: 'snake_case',
  dbCredentials: { url },
});
