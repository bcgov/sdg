import { Module } from '@nestjs/common';

import { CLOCK, systemClock } from '../delivery/settings.js';
import { RecipientsModule } from '../recipients/recipients.module.js';
import { InboxQueriesService } from './inbox-queries.service.js';
import { InboxController } from './inbox.controller.js';
import { InboxService } from './inbox.service.js';
import { ReadAllService } from './read-all.service.js';
import { INBOX_SIGNALS } from './signals/inbox-signals.js';
import { PgInboxSignals } from './signals/pg-inbox-signals.js';

/** The in-app inbox for relayed users (R18, R50) and its change listener (KTD3): the API role's. */
@Module({
  imports: [RecipientsModule],
  controllers: [InboxController],
  providers: [
    { provide: CLOCK, useValue: systemClock },
    { provide: INBOX_SIGNALS, useClass: PgInboxSignals },
    InboxQueriesService,
    InboxService,
    ReadAllService,
  ],
})
export class InboxModule {}
