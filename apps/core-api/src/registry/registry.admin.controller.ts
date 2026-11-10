import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AdminGuard } from '../auth/audience.guards.js';
import type { Caller } from '../auth/caller.js';
import { CurrentCaller } from '../auth/current-caller.decorator.js';
import { PrincipalsService } from '../principals/principals.service.js';
import {
  addServiceClientSchema,
  clientIdSchema,
  historyPageSchema,
  historyQuerySchema,
  serviceClientListSchema,
  serviceClientSchema,
  type AddServiceClient,
  type HistoryPage,
  type HistoryQuery,
  type ServiceClientView,
} from './registry.schemas.js';
import { RegistryService, type Actor } from './registry.service.js';

const clientIdParam = { schema: clientIdSchema };

/**
 * The service-account registry for administrators: admin-client tokens with the admin client role. Every
 * change records the administrator's principal and display name, so they must have signed in through admin-api.
 */
@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
@ApiForbiddenResponse({ description: 'Not an administrator, or one who has never signed in' })
@Controller({ path: 'admin/service-clients', version: '1' })
@UseGuards(AdminGuard)
export class RegistryAdminController {
  private readonly registry: RegistryService;
  private readonly principals: PrincipalsService;

  constructor(
    @Inject(RegistryService) registry: RegistryService,
    @Inject(PrincipalsService) principals: PrincipalsService,
  ) {
    this.registry = registry;
    this.principals = principals;
  }

  @Get()
  @ApiOkResponse({ description: 'Every registered client, by client id', standardSchema: serviceClientListSchema })
  list(): Promise<ServiceClientView[]> {
    return this.registry.list();
  }

  @Get('history')
  @ApiOkResponse({ description: 'Every registry change, newest first', standardSchema: historyPageSchema })
  @ApiBadRequestResponse({ description: 'limit outside 1–200 or a malformed cursor' })
  history(@Query({ schema: historyQuerySchema }) query: HistoryQuery): Promise<HistoryPage> {
    return this.registry.history(query);
  }

  @Post()
  @ApiCreatedResponse({ description: 'The new, enabled entry', standardSchema: serviceClientSchema })
  @ApiBadRequestResponse({ description: 'A malformed client id or display name, or the portal or admin client id' })
  @ApiConflictResponse({ description: 'The client id is already registered' })
  async add(
    @CurrentCaller() caller: Caller,
    @Body({ schema: addServiceClientSchema }) body: AddServiceClient,
  ): Promise<ServiceClientView> {
    return this.registry.add(body, await this.actor(caller));
  }

  @Post(':clientId/disable')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'The entry, disabled (unchanged if it already was)',
    standardSchema: serviceClientSchema,
  })
  @ApiNotFoundResponse({ description: 'The client id is not registered' })
  async disable(
    @CurrentCaller() caller: Caller,
    @Param('clientId', clientIdParam) clientId: string,
  ): Promise<ServiceClientView> {
    return this.registry.setEnabled(clientId, false, await this.actor(caller));
  }

  @Post(':clientId/enable')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'The entry, enabled (unchanged if it already was)',
    standardSchema: serviceClientSchema,
  })
  @ApiNotFoundResponse({ description: 'The client id is not registered' })
  async enable(
    @CurrentCaller() caller: Caller,
    @Param('clientId', clientIdParam) clientId: string,
  ): Promise<ServiceClientView> {
    return this.registry.setEnabled(clientId, true, await this.actor(caller));
  }

  @Delete(':clientId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Removed; its history stays' })
  @ApiNotFoundResponse({ description: 'The client id is not registered' })
  async remove(@CurrentCaller() caller: Caller, @Param('clientId', clientIdParam) clientId: string): Promise<void> {
    await this.registry.remove(clientId, await this.actor(caller));
  }

  /** The administrator's principal, looked up by identity as /api/v1/shared/me does. */
  private async actor(caller: Caller): Promise<Actor> {
    const principal = await this.principals.findByIdentity(caller.user.issuer, caller.user.subject);
    if (principal === undefined) throw new ForbiddenException('Sign in before changing the registry');
    return { principalId: principal.id, name: principal.name };
  }
}
