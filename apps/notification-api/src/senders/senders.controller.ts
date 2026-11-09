import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../auth/admin.guard.js';
import { OwnerGuard } from '../auth/owner.guard.js';
import { BEARER_AUTH } from '../openapi/swagger.js';
import {
  callbackResponseSchema,
  createSenderSchema,
  grantParamsSchema,
  ownerSchema,
  senderParamsSchema,
  senderSchema,
  setCallbackSchema,
  type CallbackResponse,
  type CreateSender,
  type GrantParams,
  type Owner,
  type SenderParams,
  type SenderResponse,
  type SetCallback,
} from './senders.schemas.js';
import { SendersService } from './senders.service.js';

/** Admin endpoints (R6): create senders, name their owners, grant and revoke Notification types. */
@ApiTags('admin')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(AdminGuard)
@Controller({ path: 'admin/senders', version: '1' })
export class AdminSendersController {
  private readonly senders: SendersService;

  constructor(@Inject(SendersService) senders: SendersService) {
    this.senders = senders;
  }

  @Post()
  @ApiCreatedResponse({ description: 'The new sender', standardSchema: senderSchema })
  create(@Body({ schema: createSenderSchema }) { name }: CreateSender): Promise<SenderResponse> {
    return this.senders.create(name);
  }

  @Post(':senderId/owners')
  @HttpCode(200)
  @ApiOkResponse({ description: 'The sender with the owner named', standardSchema: senderSchema })
  addOwner(
    @Param({ schema: senderParamsSchema }) { senderId }: SenderParams,
    @Body({ schema: ownerSchema }) owner: Owner,
  ): Promise<SenderResponse> {
    return this.senders.addOwner(senderId, owner);
  }

  @Delete(':senderId/owners')
  @ApiOkResponse({ description: 'The sender without the owner', standardSchema: senderSchema })
  removeOwner(
    @Param({ schema: senderParamsSchema }) { senderId }: SenderParams,
    @Query({ schema: ownerSchema }) owner: Owner,
  ): Promise<SenderResponse> {
    return this.senders.removeOwner(senderId, owner);
  }

  @Put(':senderId/grants/:typeKey')
  @ApiOkResponse({ description: 'The sender with the type granted', standardSchema: senderSchema })
  grant(@Param({ schema: grantParamsSchema }) { senderId, typeKey }: GrantParams): Promise<SenderResponse> {
    return this.senders.grant(senderId, typeKey);
  }

  @Delete(':senderId/grants/:typeKey')
  @ApiOkResponse({
    description: "The sender with the type revoked, which is also removed from every credential's scope",
    standardSchema: senderSchema,
  })
  revoke(@Param({ schema: grantParamsSchema }) { senderId, typeKey }: GrantParams): Promise<SenderResponse> {
    return this.senders.revoke(senderId, typeKey);
  }
}

/** Sender-owner endpoints (R7): an owner of the sender, or an admin. */
@ApiTags('senders')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(OwnerGuard)
@Controller({ path: 'senders/:senderId', version: '1' })
export class SendersController {
  private readonly senders: SendersService;

  constructor(@Inject(SendersService) senders: SendersService) {
    this.senders = senders;
  }

  @Get()
  @ApiOkResponse({ description: 'The sender; never its callback secret', standardSchema: senderSchema })
  get(@Param({ schema: senderParamsSchema }) { senderId }: SenderParams): Promise<SenderResponse> {
    return this.senders.get(senderId);
  }

  @Put('callback')
  @ApiOkResponse({
    description: 'The callback URL and its new signing secret, shown only in this response (KTD10)',
    standardSchema: callbackResponseSchema,
  })
  setCallback(
    @Param({ schema: senderParamsSchema }) { senderId }: SenderParams,
    @Body({ schema: setCallbackSchema }) { url }: SetCallback,
  ): Promise<CallbackResponse> {
    return this.senders.setCallback(senderId, url);
  }
}
