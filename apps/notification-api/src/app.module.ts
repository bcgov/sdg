import { type DynamicModule, Module } from '@nestjs/common';

import { AppConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { RoleModule } from './roles/role.js';

@Module({})
export class AppModule {
  /** Built per app instance: the environment, and with it NOTIFICATION_ROLE, is read when the app is created. */
  static register(): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.register(),
        LoggingModule,
        HealthModule,
        RoleModule.register({
          // Feature modules with API controllers (served by the api and all roles).
          api: [],
          // Worker loops (run by the worker and all roles).
          worker: { loops: [] },
        }),
      ],
    };
  }
}
