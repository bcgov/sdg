import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module.js';
import { CredentialsController } from './credentials.controller.js';
import { CredentialsService } from './credentials.service.js';
import { AdminSendersController, SendersController } from './senders.controller.js';
import { SendersService } from './senders.service.js';

/**
 * Senders, owners, type grants, credentials and the failure callback (R6–R9). The guards' database-backed lookups
 * (`sender-directories.ts`) are handed to AuthModule.register in app.module.ts.
 */
@Module({
  imports: [CatalogModule],
  controllers: [AdminSendersController, SendersController, CredentialsController],
  providers: [SendersService, CredentialsService],
})
export class SendersModule {}
