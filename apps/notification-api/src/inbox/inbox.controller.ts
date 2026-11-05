import { Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { RecipientGuard } from '../auth/recipient.guard.js';
import type { Principal } from '../auth/token-kind.js';
import { BEARER_AUTH } from '../openapi/swagger.js';
import { RecipientsService } from '../recipients/recipients.service.js';
import {
  inboxItemParamsSchema,
  inboxItemSchema,
  inboxPageSchema,
  inboxQuerySchema,
  type InboxItemParams,
  type InboxItemResponse,
  type InboxPage,
  type InboxQuery,
} from './inbox.schemas.js';
import { InboxService } from './inbox.service.js';

/**
 * Recipient endpoints (R50): the user's own in-app inbox, through a relaying app. Every call first creates or claims
 * the user's recipient (R32).
 */
@ApiTags('me')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(RecipientGuard)
@Controller({ path: 'me/inbox', version: '1' })
export class InboxController {
  private readonly recipients: RecipientsService;
  private readonly inbox: InboxService;

  constructor(@Inject(RecipientsService) recipients: RecipientsService, @Inject(InboxService) inbox: InboxService) {
    this.recipients = recipients;
    this.inbox = inbox;
  }

  @Get()
  @ApiOkResponse({ description: 'Your in-app items, newest first', standardSchema: inboxPageSchema })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query({ schema: inboxQuerySchema }) query: InboxQuery,
  ): Promise<InboxPage> {
    return this.inbox.list(await this.me(principal), query);
  }

  @Post(':itemId/read')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'The item, read; any escalation still pending for it is cancelled',
    standardSchema: inboxItemSchema,
  })
  @ApiNotFoundResponse({ description: 'No item of yours with this id' })
  async read(
    @CurrentPrincipal() principal: Principal,
    @Param({ schema: inboxItemParamsSchema }) { itemId }: InboxItemParams,
  ): Promise<InboxItemResponse> {
    return this.inbox.read(await this.me(principal), itemId);
  }

  @Post(':itemId/acknowledge')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'The item, acknowledged and read; any escalation still pending for it is cancelled',
    standardSchema: inboxItemSchema,
  })
  @ApiNotFoundResponse({ description: 'No item of yours with this id' })
  async acknowledge(
    @CurrentPrincipal() principal: Principal,
    @Param({ schema: inboxItemParamsSchema }) { itemId }: InboxItemParams,
  ): Promise<InboxItemResponse> {
    return this.inbox.acknowledge(await this.me(principal), itemId);
  }

  /** The caller's recipient id; the RecipientGuard guarantees a relayed user token. */
  private me(principal: Principal): Promise<string> {
    return this.recipients.claimUser(principal.user);
  }
}
