import { Controller, Get, Inject, Res, UseGuards, type BeforeApplicationShutdown } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { RecipientGuard } from '../auth/recipient.guard.js';
import type { Principal } from '../auth/token-kind.js';
import { BEARER_AUTH } from '../openapi/swagger.js';
import { RecipientsService } from '../recipients/recipients.service.js';
import { INBOX_SIGNALS, type InboxSignals } from './signals/inbox-signals.js';
import { openEventStream, type EventStream } from './sse.js';

/** Milliseconds until the token's `exp`, or null when it has none. */
function msUntilExpiry(principal: Principal): number | null {
  const exp = principal.user.claims['exp'];
  return typeof exp === 'number' ? Math.max(0, exp * 1000 - Date.now()) : null;
}

/**
 * The caller's live "inbox changed" stream (KTD4): `event: changed` on every change to their own inbox and nothing
 * about anyone else's (R27, R28). It ends when the token expires, when the client goes away and on shutdown.
 */
@ApiTags('me')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(RecipientGuard)
@Controller({ path: 'me/inbox', version: '1' })
export class InboxStreamController implements BeforeApplicationShutdown {
  private readonly recipients: RecipientsService;
  private readonly signals: InboxSignals;
  private readonly open = new Set<EventStream>();

  constructor(@Inject(RecipientsService) recipients: RecipientsService, @Inject(INBOX_SIGNALS) signals: InboxSignals) {
    this.recipients = recipients;
    this.signals = signals;
  }

  @Get('stream')
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'Server-Sent Events: `changed` whenever your inbox changes, refetch on each' })
  async stream(@CurrentPrincipal() principal: Principal, @Res() res: Response): Promise<void> {
    const recipientId = await this.recipients.claimUser(principal.user);
    // A client that left while this waited has already fired 'close', so the stream would never end.
    if (res.destroyed || res.req.socket.destroyed) return;
    const stream = openEventStream(res);
    const unsubscribe = this.signals.subscribe(recipientId, () => stream.changed());
    const expiresIn = msUntilExpiry(principal);
    const expiry = expiresIn === null ? null : setTimeout(() => stream.end(), expiresIn);
    this.open.add(stream);
    stream.onEnd(() => {
      unsubscribe();
      if (expiry) clearTimeout(expiry);
      this.open.delete(stream);
    });
  }

  /** Ends every open stream, so the HTTP server can close and the clients reconnect to another instance. */
  beforeApplicationShutdown(): void {
    for (const stream of this.open) stream.end();
  }
}
