import { getDrizzleToken } from '@nestjs/drizzle';
import type { HealthModuleAsyncOptions } from '@repo/server-core/nestjs';
import { sql } from 'drizzle-orm';

import type { Database } from '../database/database.module.js';

/**
 * GET /healthz/ready: core-api's own database only. Keycloak stays out: an unreachable IdP answers 503 per request
 *, and taking every pod out of rotation for it would only turn those 503s into connection errors.
 */
export const readiness: HealthModuleAsyncOptions = {
  inject: [getDrizzleToken()],
  useFactory: (db: Database) => ({
    database: async () => {
      await db.execute(sql`select 1`);
    },
  }),
};
