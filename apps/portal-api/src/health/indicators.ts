import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import type { OidcClient } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import { sql } from 'drizzle-orm';

import { InjectDatabase, type PortalDatabase } from '../database/database.module.js';
import { VALKEY_CLIENT, type ValkeyClient } from '../valkey/valkey.module.js';

export const CHECK_TIMEOUT_MS = 3000;

@Injectable()
export class DependencyIndicators {
  private readonly health: HealthIndicatorService;
  private readonly db: PortalDatabase;
  private readonly valkey: ValkeyClient;
  private readonly oidc: OidcClient;

  constructor(
    @Inject(HealthIndicatorService) health: HealthIndicatorService,
    @InjectDatabase() db: PortalDatabase,
    @Inject(VALKEY_CLIENT) valkey: ValkeyClient,
    @Inject(OIDC_CLIENT) oidc: OidcClient,
  ) {
    this.health = health;
    this.db = db;
    this.valkey = valkey;
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

  valkeyPing(): PromiseLike<HealthIndicatorResult<'valkey'>> {
    return this.health
      .check('valkey')
      .attempt(async () => {
        if (!this.valkey.isReady) throw new Error('Valkey is not connected');
        await this.valkey.ping();
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
