import {
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Logger,
  Post,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { InternalGuard } from '../auth/audience.guards.js';
import { readCallerProfile } from '../auth/caller-profile.js';
import type { Caller } from '../auth/caller.js';
import { CurrentCaller } from '../auth/current-caller.decorator.js';
import { warnOnTokenProfileClaims } from '../auth/profile-claims.js';
import { UserinfoClient } from '../auth/userinfo.client.js';
import { loginResponseSchema, type LoginResponse } from './principals.schemas.js';
import { PrincipalsService } from './principals.service.js';

/**
 * The BFFs' sign-in step: after the code exchange, the BFF sends the fresh access token and core-api
 * creates or refreshes the caller's principal. Outside /api, so no forwarder ever reaches it.
 */
@ApiTags('internal')
@ApiBearerAuth()
@Controller({ path: 'internal/principals', version: VERSION_NEUTRAL })
@UseGuards(InternalGuard)
export class PrincipalsController {
  private readonly logger = new Logger(PrincipalsController.name);
  private readonly principals: PrincipalsService;
  private readonly userinfo: UserinfoClient;

  constructor(
    @Inject(PrincipalsService) principals: PrincipalsService,
    @Inject(UserinfoClient) userinfo: UserinfoClient,
  ) {
    this.principals = principals;
    this.userinfo = userinfo;
  }

  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ description: 'The caller’s principal, created or refreshed', standardSchema: loginResponseSchema })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token, or Keycloak refused it at userinfo' })
  @ApiForbiddenResponse({ description: 'A console-client token without the admin client role, or a service account' })
  @ApiServiceUnavailableResponse({ description: 'Keycloak’s signing keys or userinfo endpoint are unreachable' })
  async login(@CurrentCaller() caller: Caller): Promise<LoginResponse> {
    // InternalGuard already refuses service accounts; the check narrows the kind for the sign-in marker.
    if (caller.kind === 'service-account') throw new ForbiddenException();
    if (caller.kind === 'console-user' && !caller.isAdmin) {
      throw new ForbiddenException('The admin client role is required');
    }
    warnOnTokenProfileClaims(this.logger, caller.user.claims);
    const profile = await readCallerProfile(this.userinfo, caller, this.logger, 'Sign-in is temporarily unavailable');
    const { principalId } = await this.principals.upsertFromLogin(profile, caller.kind);
    return { principalId, name: profile.name, email: profile.email };
  }
}
