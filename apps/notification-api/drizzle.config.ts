import { existsSync } from 'node:fs';

import { defineConfig } from 'drizzle-kit';

if (existsSync('.env')) process.loadEnvFile('.env');

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('DATABASE_URL is not set. Copy apps/notification-api/.env.example to .env, or export it.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
