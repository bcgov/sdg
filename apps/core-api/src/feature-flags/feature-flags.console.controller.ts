import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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

import { ConsoleGuard } from '../auth/audience.guards.js';
import type { Caller } from '../auth/caller.js';
import { CurrentCaller } from '../auth/current-caller.decorator.js';
import { PrincipalsService } from '../principals/principals.service.js';
import { actorOf } from './feature-flag-records.js';
import {
  createFlagSchema,
  flagDetailSchema,
  flagHistoryPageSchema,
  flagHistoryQuerySchema,
  flagKeyParam,
  flagSummaryListSchema,
  flagSummarySchema,
  updateFlagSchema,
  type CreateFlag,
  type FlagDetail,
  type FlagHistoryPage,
  type FlagHistoryQuery,
  type FlagSummary,
  type UpdateFlag,
} from './feature-flags.schemas.js';
import { FeatureFlagsService } from './feature-flags.service.js';

/**
 * Flag management and history for administrators: console-client tokens with the admin client role (R20). Every
 * change records the administrator's principal and display name, so they must have signed in through console-api.
 */
@ApiTags('console')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
@ApiForbiddenResponse({ description: 'Not an administrator, or one who has never signed in' })
@Controller({ path: 'console', version: '1' })
@UseGuards(ConsoleGuard)
export class FeatureFlagsConsoleController {
  private readonly flags: FeatureFlagsService;
  private readonly principals: PrincipalsService;

  constructor(
    @Inject(FeatureFlagsService) flags: FeatureFlagsService,
    @Inject(PrincipalsService) principals: PrincipalsService,
  ) {
    this.flags = flags;
    this.principals = principals;
  }

  @Get('feature-flags')
  @ApiOkResponse({ description: 'Every flag by key, with its override counts', standardSchema: flagSummaryListSchema })
  list(): Promise<FlagSummary[]> {
    return this.flags.list();
  }

  @Post('feature-flags')
  @ApiCreatedResponse({ description: 'The new flag', standardSchema: flagSummarySchema })
  @ApiBadRequestResponse({ description: 'A malformed key, description, rollout or audience' })
  @ApiConflictResponse({ description: 'The key already exists' })
  async create(
    @CurrentCaller() caller: Caller,
    @Body({ schema: createFlagSchema }) body: CreateFlag,
  ): Promise<FlagSummary> {
    return this.flags.create(body, await actorOf(this.principals, caller));
  }

  @Get('feature-flags/:key')
  @ApiOkResponse({ description: 'The flag and every override', standardSchema: flagDetailSchema })
  @ApiNotFoundResponse({ description: 'The flag does not exist' })
  detail(@Param('key', flagKeyParam) key: string): Promise<FlagDetail> {
    return this.flags.detail(key);
  }

  @Patch('feature-flags/:key')
  @ApiOkResponse({
    description: 'The flag after the change (unchanged if nothing differed), with its override counts',
    standardSchema: flagSummarySchema,
  })
  @ApiBadRequestResponse({ description: 'A malformed field, or a field that cannot change, such as the key' })
  @ApiNotFoundResponse({ description: 'The flag does not exist' })
  async update(
    @CurrentCaller() caller: Caller,
    @Param('key', flagKeyParam) key: string,
    @Body({ schema: updateFlagSchema }) body: UpdateFlag,
  ): Promise<FlagSummary> {
    return this.flags.update(key, body, await actorOf(this.principals, caller));
  }

  @Delete('feature-flags/:key')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Deleted with its overrides; its history stays' })
  @ApiNotFoundResponse({ description: 'The flag does not exist' })
  async remove(@CurrentCaller() caller: Caller, @Param('key', flagKeyParam) key: string): Promise<void> {
    await this.flags.remove(key, await actorOf(this.principals, caller));
  }

  @Get('feature-flag-history')
  @ApiOkResponse({ description: 'Every flag change, newest first', standardSchema: flagHistoryPageSchema })
  @ApiBadRequestResponse({ description: 'A malformed key, limit outside 1–200 or a malformed cursor' })
  history(@Query({ schema: flagHistoryQuerySchema }) query: FlagHistoryQuery): Promise<FlagHistoryPage> {
    return this.flags.history(query);
  }
}
