import { Module } from '@nestjs/common';
import { HealthModule, LoggingModule } from '@repo/server-core/nestjs';

import { AppConfigModule } from './config/config.module.js';
import { GatewayForwardController } from './forward/gateway-forward.controller.js';
import { readiness } from './health/readiness.js';

/** The service accounts' entry point: forwarding to core-api, and nothing else (no database, session or login). */
@Module({
  imports: [AppConfigModule, LoggingModule, HealthModule.forRootAsync(readiness)],
  controllers: [GatewayForwardController],
})
export class AppModule {}
