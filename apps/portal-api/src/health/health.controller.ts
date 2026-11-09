import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';

import { DependencyIndicators } from './indicators.js';

/** Probes live outside the /api prefix (see bootstrap) and are never versioned. */
@ApiTags('health')
@Controller({ path: 'healthz', version: VERSION_NEUTRAL })
export class HealthController {
  private readonly health: HealthCheckService;
  private readonly indicators: DependencyIndicators;

  constructor(
    @Inject(HealthCheckService) health: HealthCheckService,
    @Inject(DependencyIndicators) indicators: DependencyIndicators,
  ) {
    this.health = health;
    this.indicators = indicators;
  }

  /** The process is up and serving requests; never touches dependencies. */
  @Get('live')
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  /** Every dependency needed to serve a login (Postgres also holds sessions) is reachable. 503 when any check is down. */
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([() => this.indicators.database(), () => this.indicators.keycloak()]);
  }
}
