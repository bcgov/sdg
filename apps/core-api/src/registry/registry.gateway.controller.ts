import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentServiceClient, GatewayGuard } from './gateway.guard.js';
import { serviceClientSchema, type ServiceClientView } from './registry.schemas.js';

/** The gateway audience's first route: who the calling service account is in the registry. */
@ApiTags('gateway')
@ApiBearerAuth()
@Controller({ path: 'gateway/me', version: '1' })
@UseGuards(GatewayGuard)
export class RegistryGatewayController {
  @Get()
  @ApiOkResponse({ description: 'The calling client’s registry entry', standardSchema: serviceClientSchema })
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired token' })
  @ApiForbiddenResponse({ description: 'Not a service account, or a client that is not registered or is disabled' })
  @ApiServiceUnavailableResponse({ description: 'Keycloak’s signing keys are unreachable' })
  me(@CurrentServiceClient() entry: ServiceClientView): ServiceClientView {
    return entry;
  }
}
