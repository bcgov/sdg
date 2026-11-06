import { Module } from '@nestjs/common';

import { CLOCK, systemClock } from '../delivery/settings.js';
import { RecipientsModule } from '../recipients/recipients.module.js';
import { InboxQueriesService } from './inbox-queries.service.js';
import { InboxController } from './inbox.controller.js';
import { InboxService } from './inbox.service.js';

/** The in-app inbox for relayed users (R18, R50): the API role's. */
@Module({
  imports: [RecipientsModule],
  controllers: [InboxController],
  providers: [{ provide: CLOCK, useValue: systemClock }, InboxQueriesService, InboxService],
})
export class InboxModule {}
