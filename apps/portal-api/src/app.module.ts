import { Module } from '@nestjs/common';
import { BffModule } from '@repo/bff-core/nestjs';
import { HealthModule, LoggingModule } from '@repo/server-core/nestjs';

import { portalBff } from './bff/bff-options.js';
import { AppConfigModule } from './config/config.module.js';
import { readiness } from './health/readiness.js';

/** The resident portal's BFF: bff-core's login, sessions and forwarding to core-api, and nothing else. */
@Module({
  imports: [AppConfigModule, LoggingModule, BffModule.forRootAsync(portalBff), HealthModule.forRootAsync(readiness)],
})
export class AppModule {}
