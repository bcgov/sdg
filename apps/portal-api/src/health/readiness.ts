import { getDrizzleToken } from '@nestjs/drizzle';
import type { OidcClient } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import type { HealthModuleAsyncOptions } from '@repo/server-core/nestjs';
import { sql } from 'drizzle-orm';

import { AuthModule } from '../auth/auth.module.js';
import type { Database } from '../database/database.module.js';

/** GET /healthz/ready: Postgres (which also holds sessions) and Keycloak, everything needed to serve a login. */
export const readiness: HealthModuleAsyncOptions = {
  imports: [AuthModule],
  inject: [getDrizzleToken(), OIDC_CLIENT],
  useFactory: (db: Database, oidc: OidcClient) => ({
    database: async () => {
      await db.execute(sql`select 1`);
    },
    keycloak: () => oidc.discover(),
  }),
};
