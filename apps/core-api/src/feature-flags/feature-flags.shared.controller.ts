import { Controller, Get, Inject, NotFoundException, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { OptionalSharedGuard } from '../auth/audience.guards.js';
import type { Caller } from '../auth/caller.js';
import { OptionalCaller } from '../auth/optional-caller.decorator.js';
import { flagListSchema, helloWorldSchema, type FlagList, type HelloWorld } from './feature-flags.schemas.js';
import { FlagEvaluationService } from './flag-evaluation.service.js';

export const HELLO_WORLD_FLAG = 'hello_world';

/**
 * Each answer depends on who asks and is read fresh (KTD10), so nothing may store it: set before the handler can
 * throw, so hello-world's 404 (cacheable by default) carries it too.
 */
function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store');
}

/**
 * The evaluated flag list and the hello-world demo, for anonymous portal visitors and portal or console people
 * (KTD1, KTD3). Both read the same evaluation, so they always agree (R12).
 */
@ApiTags('shared')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'A malformed or invalid token (no token is a signed-out portal visitor)' })
@ApiForbiddenResponse({ description: 'A service-account token' })
@Controller({ path: 'shared', version: '1' })
@UseGuards(OptionalSharedGuard)
export class FeatureFlagsSharedController {
  private readonly evaluation: FlagEvaluationService;

  constructor(@Inject(FlagEvaluationService) evaluation: FlagEvaluationService) {
    this.evaluation = evaluation;
  }

  @Get('flags')
  @ApiOkResponse({
    description: 'Each flag on for the caller in its app, mapped to true',
    standardSchema: flagListSchema,
  })
  async flags(
    @OptionalCaller() caller: Caller | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FlagList> {
    noStore(res);
    const keys = await this.evaluation.enabledKeys(caller);
    return Object.fromEntries([...keys].map((key) => [key, true] as const));
  }

  @Get('hello-world')
  @ApiOkResponse({
    description: 'The greeting, when hello_world is on for the caller',
    standardSchema: helloWorldSchema,
  })
  @ApiNotFoundResponse({ description: 'hello_world is off for the caller' })
  async helloWorld(
    @OptionalCaller() caller: Caller | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HelloWorld> {
    noStore(res);
    const keys = await this.evaluation.enabledKeys(caller);
    if (!keys.has(HELLO_WORLD_FLAG)) throw new NotFoundException();
    return { message: 'Hello, world!' };
  }
}
