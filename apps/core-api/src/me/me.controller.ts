import { Controller, Get, Inject, NotFoundException, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { SharedGuard } from '../auth/audience.guards.js';
import type { Caller } from '../auth/caller.js';
import { CurrentCaller } from '../auth/current-caller.decorator.js';
import { principalSchema, type PrincipalResponse } from '../principals/principals.schemas.js';
import { PrincipalsService } from '../principals/principals.service.js';

/** The shared "current user" route (R4): any person token from the portal or the admin client. */
@ApiTags('shared')
@ApiBearerAuth()
@Controller({ path: 'shared/me', version: '1' })
@UseGuards(SharedGuard)
export class MeController {
  private readonly principals: PrincipalsService;

  constructor(@Inject(PrincipalsService) principals: PrincipalsService) {
    this.principals = principals;
  }

  @Get()
  @ApiOkResponse({ description: 'The caller’s principal', standardSchema: principalSchema })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiForbiddenResponse({ description: 'Not a person token' })
  @ApiNotFoundResponse({ description: 'The caller has never signed in' })
  async me(@CurrentCaller() caller: Caller): Promise<PrincipalResponse> {
    const principal = await this.principals.findByIdentity(caller.user.issuer, caller.user.subject);
    if (principal === undefined) throw new NotFoundException('No principal for this identity');
    return principal;
  }
}
