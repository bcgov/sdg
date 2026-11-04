import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { ConfirmController } from './confirm.controller.js';
import { ContactPointsService } from './contact-points.service.js';
import { MeController } from './me.controller.js';
import { RateLimitService } from './rate-limit.service.js';
import { RecipientsService } from './recipients.service.js';
import { SenderRecipientsController, TopicSubscribersController } from './sender-recipients.controller.js';
import { SettingsService } from './settings.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { VerificationService } from './verification.service.js';

/**
 * The recipient registry, contact points, verification, settings and subscriptions (R17, R27, R32–R40). No
 * controllers, so sends (U9) and the worker role's delivery (U10) can import it.
 */
@Module({
  imports: [CatalogModule, IntegrationsModule],
  providers: [
    RecipientsService,
    ContactPointsService,
    VerificationService,
    RateLimitService,
    SettingsService,
    SubscriptionsService,
  ],
  exports: [RecipientsService, ContactPointsService, VerificationService, SettingsService, SubscriptionsService],
})
export class RecipientsModule {}

/** Recipient, sender and public confirm endpoints: the API role's. */
@Module({
  imports: [RecipientsModule],
  controllers: [MeController, SenderRecipientsController, TopicSubscribersController, ConfirmController],
})
export class RecipientsApiModule {}
