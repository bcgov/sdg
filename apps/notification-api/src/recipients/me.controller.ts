import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { RecipientGuard } from '../auth/recipient.guard.js';
import type { Principal } from '../auth/token-kind.js';
import { topicParamsSchema, type TopicParams, type TopicResponse } from '../catalog/catalog.schemas.js';
import { BEARER_AUTH } from '../openapi/swagger.js';
import { ContactPointsService } from './contact-points.service.js';
import {
  addContactPointSchema,
  channelParamsSchema,
  channelSwitchSchema,
  contactPointListSchema,
  contactPointParamsSchema,
  contactPointSchema,
  editContactPointSchema,
  settingsSchema,
  subscriptionListSchema,
  updateSettingsSchema,
  type AddContactPoint,
  type ChannelParams,
  type ChannelSwitch,
  type ContactPointParams,
  type ContactPointResponse,
  type EditContactPoint,
  type SettingsResponse,
  type UpdateSettings,
} from './recipients.schemas.js';
import { RecipientsService } from './recipients.service.js';
import { SettingsService } from './settings.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

/**
 * Recipient endpoints (R10, R11): the user's own settings, contact points and subscriptions, through a relaying app.
 * Every call first creates or claims the user's recipient (R32).
 */
@ApiTags('me')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(RecipientGuard)
@Controller({ path: 'me', version: '1' })
export class MeController {
  private readonly recipients: RecipientsService;
  private readonly settings: SettingsService;
  private readonly contactPoints: ContactPointsService;
  private readonly subscriptions: SubscriptionsService;

  constructor(
    @Inject(RecipientsService) recipients: RecipientsService,
    @Inject(SettingsService) settings: SettingsService,
    @Inject(ContactPointsService) contactPoints: ContactPointsService,
    @Inject(SubscriptionsService) subscriptions: SubscriptionsService,
  ) {
    this.recipients = recipients;
    this.settings = settings;
    this.contactPoints = contactPoints;
    this.subscriptions = subscriptions;
  }

  @Get()
  @ApiOkResponse({ description: 'Your settings', standardSchema: settingsSchema })
  async get(@CurrentPrincipal() principal: Principal): Promise<SettingsResponse> {
    return this.settings.get(await this.me(principal));
  }

  @Patch()
  @ApiOkResponse({
    description: 'Your settings, with language, timezone or quiet hours changed',
    standardSchema: settingsSchema,
  })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Body({ schema: updateSettingsSchema }) input: UpdateSettings,
  ): Promise<SettingsResponse> {
    return this.settings.update(await this.me(principal), input);
  }

  @Put('channels/:channel')
  @ApiOkResponse({
    description: 'Your settings with the channel switched (in-app cannot be switched off)',
    standardSchema: settingsSchema,
  })
  async setChannel(
    @CurrentPrincipal() principal: Principal,
    @Param({ schema: channelParamsSchema }) { channel }: ChannelParams,
    @Body({ schema: channelSwitchSchema }) { enabled }: ChannelSwitch,
  ): Promise<SettingsResponse> {
    return this.settings.setChannel(await this.me(principal), channel, enabled);
  }

  @Get('contact-points')
  @ApiOkResponse({ description: 'Your own contact points', standardSchema: contactPointListSchema })
  async listContactPoints(@CurrentPrincipal() principal: Principal): Promise<ContactPointResponse[]> {
    return this.contactPoints.listOwn(await this.me(principal));
  }

  @Post('contact-points')
  @ApiCreatedResponse({
    description: 'The new, unverified address; a confirmation was sent to it',
    standardSchema: contactPointSchema,
  })
  async addContactPoint(
    @CurrentPrincipal() principal: Principal,
    @Body({ schema: addContactPointSchema }) { address }: AddContactPoint,
  ): Promise<ContactPointResponse> {
    return this.contactPoints.addOwn(await this.me(principal), address);
  }

  @Patch('contact-points/:contactPointId')
  @ApiOkResponse({
    description: 'The address, unverified until confirmed when it changed',
    standardSchema: contactPointSchema,
  })
  async editContactPoint(
    @CurrentPrincipal() principal: Principal,
    @Param({ schema: contactPointParamsSchema }) { contactPointId }: ContactPointParams,
    @Body({ schema: editContactPointSchema }) { address }: EditContactPoint,
  ): Promise<ContactPointResponse> {
    return this.contactPoints.editOwn(await this.me(principal), contactPointId, address);
  }

  @Delete('contact-points/:contactPointId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Removed' })
  async removeContactPoint(
    @CurrentPrincipal() principal: Principal,
    @Param({ schema: contactPointParamsSchema }) { contactPointId }: ContactPointParams,
  ): Promise<void> {
    await this.contactPoints.removeOwn(await this.me(principal), contactPointId);
  }

  @Post('contact-points/:contactPointId/resend')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Another confirmation was sent' })
  async resend(
    @CurrentPrincipal() principal: Principal,
    @Param({ schema: contactPointParamsSchema }) { contactPointId }: ContactPointParams,
  ): Promise<void> {
    await this.contactPoints.resend(await this.me(principal), contactPointId);
  }

  @Get('subscriptions')
  @ApiOkResponse({ description: 'The topics you are subscribed to', standardSchema: subscriptionListSchema })
  async listSubscriptions(@CurrentPrincipal() principal: Principal): Promise<TopicResponse[]> {
    return this.subscriptions.listOwn(await this.me(principal));
  }

  @Put('subscriptions/:topicId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Subscribed; 403 when the topic does not allow it' })
  async subscribe(
    @CurrentPrincipal() principal: Principal,
    @Param({ schema: topicParamsSchema }) { topicId }: TopicParams,
  ): Promise<void> {
    await this.subscriptions.subscribeSelf(await this.me(principal), topicId);
  }

  @Delete('subscriptions/:topicId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Unsubscribed; 403 when the topic does not allow it' })
  async unsubscribe(
    @CurrentPrincipal() principal: Principal,
    @Param({ schema: topicParamsSchema }) { topicId }: TopicParams,
  ): Promise<void> {
    await this.subscriptions.unsubscribeSelf(await this.me(principal), topicId);
  }

  /** The caller's recipient id; the RecipientGuard guarantees a relayed user token. */
  private me(principal: Principal): Promise<string> {
    return this.recipients.claimUser(principal.user);
  }
}
