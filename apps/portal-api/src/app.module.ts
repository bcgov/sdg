import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { SessionModule } from './session/session.module.js';
import { ValkeyModule } from './valkey/valkey.module.js';

@Module({
  imports: [AppConfigModule, LoggingModule, DatabaseModule, ValkeyModule, SessionModule, AuthModule, HealthModule],
})
export class AppModule {}
