import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { GuardedHttpClient } from '../outbound/http-dispatcher.js';
import { RecipientsModule } from '../recipients/recipients.module.js';
import { TemplatesModule } from '../templates/templates.module.js';
import { CallbackService } from './callbacks.js';
import { ChannelSenders } from './channel-senders.js';
import { DeliveryClaimer } from './claimer.js';
import { ExpanderService } from './expander.js';
import { PlannerService } from './planner.js';
import { DeliveryWorker } from './processor.js';
import { CLOCK, DELIVERY_SETTINGS, deliverySettings, systemClock } from './settings.js';

/**
 * The delivery engine (U10): expansion, planning, claiming, channel senders and failure callbacks, for the worker
 * role's DeliveryLoop. No controllers. The lease is sized from the guarded HTTP client's timeout, which every
 * outbound send shares (KTD1).
 */
@Module({
  imports: [RecipientsModule, IntegrationsModule, TemplatesModule],
  providers: [
    { provide: CLOCK, useValue: systemClock },
    {
      provide: DELIVERY_SETTINGS,
      inject: [ConfigService, GuardedHttpClient],
      useFactory: (config: ConfigService<Env, true>, http: GuardedHttpClient) =>
        deliverySettings(config.get('NOTIFICATION_WORKER_POLL_MS', { infer: true }), http.timeoutMs),
    },
    DeliveryClaimer,
    ExpanderService,
    PlannerService,
    ChannelSenders,
    DeliveryWorker,
    CallbackService,
  ],
  exports: [
    CLOCK,
    DELIVERY_SETTINGS,
    DeliveryClaimer,
    ExpanderService,
    PlannerService,
    DeliveryWorker,
    CallbackService,
  ],
})
export class DeliveryModule {}
