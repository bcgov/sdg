import { Body, Controller, Delete, HttpCode, Inject, Param, Put, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';

import { ConsoleGuard } from '../auth/audience.guards.js';
import type { Caller } from '../auth/caller.js';
import { CurrentCaller } from '../auth/current-caller.decorator.js';
import { PrincipalsService } from '../principals/principals.service.js';
import { FeatureFlagOverridesService } from './feature-flag-overrides.service.js';
import { actorOf } from './feature-flag-records.js';
import {
  flagKeySchema,
  overrideSchema,
  setOverrideSchema,
  type OverrideView,
  type SetOverride,
} from './feature-flags.schemas.js';

const keyParam = { schema: flagKeySchema };
const principalIdParam = { schema: z.uuid() };

/** Per-person overrides of a flag, for administrators (R18, R20). */
@ApiTags('console')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
@ApiForbiddenResponse({ description: 'Not an administrator, or one who has never signed in' })
@Controller({ path: 'console/feature-flags/:key/overrides', version: '1' })
@UseGuards(ConsoleGuard)
export class FeatureFlagOverridesConsoleController {
  private readonly overrides: FeatureFlagOverridesService;
  private readonly principals: PrincipalsService;

  constructor(
    @Inject(FeatureFlagOverridesService) overrides: FeatureFlagOverridesService,
    @Inject(PrincipalsService) principals: PrincipalsService,
  ) {
    this.overrides = overrides;
    this.principals = principals;
  }

  @Put(':principalId')
  @ApiOkResponse({
    description: 'The override, set (unchanged if it already had this value)',
    standardSchema: overrideSchema,
  })
  @ApiBadRequestResponse({ description: 'A malformed key, principal id or body' })
  @ApiNotFoundResponse({
    description: 'The flag does not exist, or the principal has not signed in to an app in its audience',
  })
  async set(
    @CurrentCaller() caller: Caller,
    @Param('key', keyParam) key: string,
    @Param('principalId', principalIdParam) principalId: string,
    @Body({ schema: setOverrideSchema }) body: SetOverride,
  ): Promise<OverrideView> {
    return this.overrides.set(key, principalId, body.enabled, await actorOf(this.principals, caller));
  }

  @Delete(':principalId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiNotFoundResponse({ description: 'The flag does not exist, or has no override for this principal' })
  async remove(
    @CurrentCaller() caller: Caller,
    @Param('key', keyParam) key: string,
    @Param('principalId', principalIdParam) principalId: string,
  ): Promise<void> {
    await this.overrides.remove(key, principalId, await actorOf(this.principals, caller));
  }
}
