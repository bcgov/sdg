import { existsSync } from 'node:fs';

import { defineConfig } from 'drizzle-kit';

if (existsSync('.env')) process.loadEnvFile('.env');

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('DATABASE_URL is not set. Copy packages/database/.env.example to .env, or export it.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  dbCredentials: { url },
  // The core login owns only the core schema; its journal lives there too (src/migrations-folder.ts).
  schemaFilter: ['core'],
  migrations: { schema: 'core' },
  strict: true,
  verbose: true,
});
