import { type DynamicModule, Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { AppConfigModule } from './config/config.module.js';
import { CryptoModule } from './crypto/crypto.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { IntegrationsApiModule } from './integrations/integrations.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { OutboundModule } from './outbound/outbound.module.js';
import { RoleModule } from './roles/role.js';
import { DbCredentialDirectory, DbSenderOwnership } from './senders/sender-directories.js';
import { SendersModule } from './senders/senders.module.js';
import { TemplatesApiModule } from './templates/templates.module.js';

@Module({})
export class AppModule {
  /** Built per app instance: the environment, and with it NOTIFICATION_ROLE, is read when the app is created. */
  static register(): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.register(),
        LoggingModule,
        DatabaseModule,
        CryptoModule,
        OutboundModule,
        HealthModule,
        RoleModule.register({
          // Feature modules with API controllers (served by the api and all roles).
          api: [
            AuthModule.register({ credentialDirectory: DbCredentialDirectory, senderOwnership: DbSenderOwnership }),
            SendersModule,
            CatalogModule,
            IntegrationsApiModule,
            TemplatesApiModule,
          ],
          // Worker loops (run by the worker and all roles).
          worker: { loops: [] },
        }),
      ],
    };
  }
}
