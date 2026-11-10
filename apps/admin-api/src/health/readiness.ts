import type { SessionDatabase } from '@repo/bff-core';
import { SESSION_DATABASE } from '@repo/bff-core/nestjs';
import type { HealthModuleAsyncOptions } from '@repo/server-core/nestjs';
import { sql } from 'drizzle-orm';

/**
 * GET /healthz/ready: admin-api's own database (its sessions) only. Keycloak and core-api outages surface per request
 * as 503 and at the login callback as `authError=unavailable`, so they never pull the pod from its Service.
 */
export const readiness: HealthModuleAsyncOptions = {
  inject: [SESSION_DATABASE],
  useFactory: (db: SessionDatabase) => ({
    database: async () => {
      await db.execute(sql`select 1`);
    },
  }),
};
