import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { OwnerGuard } from '../auth/owner.guard.js';
import { BEARER_AUTH } from '../openapi/swagger.js';
import {
  channelParamsSchema,
  integrationSchema,
  putIntegrationSchema,
  type ChannelParams,
  type IntegrationResponse,
  type PutIntegration,
} from './integrations.schemas.js';
import { IntegrationsService } from './integrations.service.js';

/** A sender's own integration per channel (R47, F4): an owner of the sender, or an admin. */
@ApiTags('senders')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(OwnerGuard)
@Controller({ path: 'senders/:senderId/integrations/:channel', version: '1' })
export class IntegrationsController {
  private readonly integrations: IntegrationsService;

  constructor(@Inject(IntegrationsService) integrations: IntegrationsService) {
    this.integrations = integrations;
  }

  @Put()
  @ApiOkResponse({
    description: "The sender's integration for the channel, overriding the platform default; never its secrets",
    standardSchema: integrationSchema,
  })
  put(
    @Param({ schema: channelParamsSchema }) { senderId, channel }: ChannelParams,
    @Body({ schema: putIntegrationSchema }) body: PutIntegration,
  ): Promise<IntegrationResponse> {
    return this.integrations.put(senderId, channel, body);
  }

  @Get()
  @ApiOkResponse({
    description: "The sender's integration for the channel; never its secrets",
    standardSchema: integrationSchema,
  })
  get(@Param({ schema: channelParamsSchema }) { senderId, channel }: ChannelParams): Promise<IntegrationResponse> {
    return this.integrations.get(senderId, channel);
  }

  @Delete()
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The channel uses the platform default again, if there is one' })
  remove(@Param({ schema: channelParamsSchema }) { senderId, channel }: ChannelParams): Promise<void> {
    return this.integrations.remove(senderId, channel);
  }
}
