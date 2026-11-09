import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { RecipientsModule } from '../recipients/recipients.module.js';
import { TemplatesModule } from '../templates/templates.module.js';
import { IdempotencyService } from './idempotency.service.js';
import { SendValidator } from './send-validation.js';
import { SendController } from './send.controller.js';
import { SendService } from './send.service.js';

/** The send API and its accept transaction (R26–R31, KTD7, KTD13): the API role's. */
@Module({
  imports: [CatalogModule, IntegrationsModule, RecipientsModule, TemplatesModule],
  controllers: [SendController],
  providers: [SendService, SendValidator, IdempotencyService],
})
export class SendingModule {}
