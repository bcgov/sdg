import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import type { OidcClient } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import { sql } from 'drizzle-orm';

import { InjectDatabase, type PortalDatabase } from '../database/database.module.js';

export const CHECK_TIMEOUT_MS = 3000;

@Injectable()
export class DependencyIndicators {
  private readonly health: HealthIndicatorService;
  private readonly db: PortalDatabase;
  private readonly oidc: OidcClient;

  constructor(
    @Inject(HealthIndicatorService) health: HealthIndicatorService,
    @InjectDatabase() db: PortalDatabase,
    @Inject(OIDC_CLIENT) oidc: OidcClient,
  ) {
    this.health = health;
    this.db = db;
    this.oidc = oidc;
  }

  database(): PromiseLike<HealthIndicatorResult<'database'>> {
    return this.health
      .check('database')
      .attempt(async () => {
        await this.db.execute(sql`select 1`);
      })
      .withTimeout(CHECK_TIMEOUT_MS);
  }

  keycloak(): PromiseLike<HealthIndicatorResult<'keycloak'>> {
    return this.health
      .check('keycloak')
      .attempt(() => this.oidc.discover())
      .withTimeout(CHECK_TIMEOUT_MS);
  }
}
