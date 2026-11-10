import { Module } from '@nestjs/common';
import { HealthModule, LoggingModule } from '@repo/server-core/nestjs';

import { AuthModule } from './auth/auth.module.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { readiness } from './health/readiness.js';
import { SessionModule } from './session/session.module.js';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    SessionModule,
    AuthModule,
    HealthModule.forRootAsync(readiness),
  ],
})
export class AppModule {}
