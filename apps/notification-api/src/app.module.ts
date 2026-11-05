import { type DynamicModule, Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { CatalogApiModule } from './catalog/catalog.module.js';
import { AppConfigModule } from './config/config.module.js';
import { CryptoModule } from './crypto/crypto.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DeliveryModule } from './delivery/delivery.module.js';
import { DeliveryLoop } from './delivery/worker-loop.js';
import { HealthModule } from './health/health.module.js';
import { HistoryModule } from './history/history.module.js';
import { InboxModule } from './inbox/inbox.module.js';
import { IntegrationsApiModule } from './integrations/integrations.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { OutboundModule } from './outbound/outbound.module.js';
import { RecipientsApiModule } from './recipients/recipients.module.js';
import { RoleModule } from './roles/role.js';
import { DbCredentialDirectory, DbSenderOwnership } from './senders/sender-directories.js';
import { SendersModule } from './senders/senders.module.js';
import { SendingModule } from './sending/sending.module.js';
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
            CatalogApiModule,
            IntegrationsApiModule,
            TemplatesApiModule,
            RecipientsApiModule,
            SendingModule,
            HistoryModule,
            InboxModule,
          ],
          // Worker loops (run by the worker and all roles).
          worker: { imports: [DeliveryModule], loops: [DeliveryLoop] },
        }),
      ],
    };
  }
}
