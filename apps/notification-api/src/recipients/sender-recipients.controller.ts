import { Body, Controller, HttpCode, Inject, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CredentialGuard } from '../auth/credential.guard.js';
import { CurrentCredential } from '../auth/current-principal.decorator.js';
import type { LinkedCredential } from '../auth/directories.js';
import { topicParamsSchema, type TopicParams } from '../catalog/catalog.schemas.js';
import { BEARER_AUTH } from '../openapi/swagger.js';
import {
  addressRecipientSchema,
  addressSettingsSchema,
  preRegisteredUserSchema,
  preRegisterUserSchema,
  recipientRefSchema,
  registerSystemSchema,
  systemRecipientSchema,
  type AddressRecipientResponse,
  type AddressSettings,
  type PreRegisterUser,
  type RecipientRef,
  type RegisterSystem,
  type SystemRecipientResponse,
} from './recipients.schemas.js';
import { RecipientsService } from './recipients.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

/** Credential endpoints (R33, R39): the sender's users, systems and address-only recipients. */
@ApiTags('recipients')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(CredentialGuard)
@Controller({ path: 'recipients', version: '1' })
export class SenderRecipientsController {
  private readonly recipients: RecipientsService;

  constructor(@Inject(RecipientsService) recipients: RecipientsService) {
    this.recipients = recipients;
  }

  @Post('users')
  @HttpCode(200)
  @ApiOkResponse({
    description: "The user, pre-registered with the sender's contact points; the same response for a known user",
    standardSchema: preRegisteredUserSchema,
  })
  async preRegisterUser(
    @CurrentCredential() credential: LinkedCredential,
    @Body({ schema: preRegisterUserSchema }) { issuer, subject, contactPoints }: PreRegisterUser,
  ): Promise<{ issuer: string; subject: string }> {
    const senderId = credential.senderId;
    await this.recipients.upsertUserForSender(senderId, { issuer, subject }, contactPoints);
    return { issuer, subject };
  }

  @Post('systems')
  @HttpCode(200)
  @ApiOkResponse({ description: 'The system with its webhook endpoints', standardSchema: systemRecipientSchema })
  registerSystem(
    @CurrentCredential() credential: LinkedCredential,
    @Body({ schema: registerSystemSchema }) input: RegisterSystem,
  ): Promise<SystemRecipientResponse> {
    return this.recipients.registerSystem(credential.senderId, input);
  }

  @Post('addresses')
  @HttpCode(200)
  @ApiOkResponse({
    description: "The sender's address-only recipient with its language and timezone",
    standardSchema: addressRecipientSchema,
  })
  setAddressSettings(
    @CurrentCredential() credential: LinkedCredential,
    @Body({ schema: addressSettingsSchema }) input: AddressSettings,
  ): Promise<AddressRecipientResponse> {
    return this.recipients.setAddressSettings(credential.senderId, input);
  }
}

/** Credential endpoint (R17): subscribe a recipient to a topic the sender may broadcast to. */
@ApiTags('topics')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(CredentialGuard)
@Controller({ path: 'topics', version: '1' })
export class TopicSubscribersController {
  private readonly recipients: RecipientsService;
  private readonly subscriptions: SubscriptionsService;

  constructor(
    @Inject(RecipientsService) recipients: RecipientsService,
    @Inject(SubscriptionsService) subscriptions: SubscriptionsService,
  ) {
    this.recipients = recipients;
    this.subscriptions = subscriptions;
  }

  @Post(':topicId/subscribers')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Subscribed; 404 unless the sender may broadcast to the topic' })
  async subscribe(
    @CurrentCredential() credential: LinkedCredential,
    @Param({ schema: topicParamsSchema }) { topicId }: TopicParams,
    @Body({ schema: recipientRefSchema }) ref: RecipientRef,
  ): Promise<void> {
    const senderId = credential.senderId;
    await this.subscriptions.requireBroadcastable(senderId, topicId);
    const recipientId = await this.resolve(senderId, ref);
    await this.subscriptions.subscribeBySender(senderId, topicId, recipientId);
  }

  /** A user by issuer + subject, created when new; or one of the sender's own systems, 404 otherwise. */
  private async resolve(senderId: string, ref: RecipientRef): Promise<string> {
    if (!('systemId' in ref)) return this.recipients.upsertUser(ref);
    const systemId = await this.recipients.findSystem(senderId, ref.systemId);
    if (!systemId) throw new NotFoundException('No system recipient with this id');
    return systemId;
  }
}
