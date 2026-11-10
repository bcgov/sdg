import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthIndicatorService, type HealthCheckResult } from '@nestjs/terminus';

import { CHECK_TIMEOUT_MS, READINESS_CHECKS, type ReadinessChecks } from './readiness.js';

/** Probes live outside the /api prefix (see configureApp) and are never versioned. */
@ApiTags('health')
@Controller({ path: 'healthz', version: VERSION_NEUTRAL })
export class HealthController {
  private readonly health: HealthCheckService;
  private readonly indicator: HealthIndicatorService;
  private readonly checks: ReadinessChecks;

  constructor(
    @Inject(HealthCheckService) health: HealthCheckService,
    @Inject(HealthIndicatorService) indicator: HealthIndicatorService,
    @Inject(READINESS_CHECKS) checks: ReadinessChecks,
  ) {
    this.health = health;
    this.indicator = indicator;
    this.checks = checks;
  }

  /** The process is up and serving requests; never touches dependencies. */
  @Get('live')
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  /** Every dependency the service needs is reachable. 503 when any check is down. */
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check(
      Object.entries(this.checks).map(
        ([name, check]) =>
          () =>
            this.indicator
              .check(name)
              .attempt(async () => {
                await check();
              })
              .withTimeout(CHECK_TIMEOUT_MS),
      ),
    );
  }
}
