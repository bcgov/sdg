import { Module } from '@nestjs/common';
import { HealthModule, LoggingModule } from '@repo/server-core/nestjs';

import { AuthModule } from './auth/auth.module.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { readiness } from './health/readiness.js';
import { PrincipalsModule } from './principals/principals.module.js';

/** Routes served outside /api (configureApp's `unprefixed`): the BFF-only /internal/*, never forwarded (KTD2). */
export const UNPREFIXED_ROUTES: readonly string[] = ['internal/{*path}'];

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    AuthModule,
    PrincipalsModule,
    HealthModule.forRootAsync(readiness),
  ],
})
export class AppModule {}
