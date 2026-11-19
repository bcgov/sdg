import { Controller, Get, Inject, Logger, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { PortalGuard } from '../auth/audience.guards.js';
import { readCallerProfile } from '../auth/caller-profile.js';
import type { Caller } from '../auth/caller.js';
import { CurrentCaller } from '../auth/current-caller.decorator.js';
import { warnOnTokenProfileClaims } from '../auth/profile-claims.js';
import { UserinfoClient } from '../auth/userinfo.client.js';
import { profileView } from './profile-view.js';
import { profileSchema, type ProfileResponse } from './profile.schemas.js';

/** The resident's profile for the portal's Settings page, read live from Keycloak userinfo and never stored (R17). */
@ApiTags('portal')
@ApiBearerAuth()
@Controller({ path: 'portal/profile', version: '1' })
@UseGuards(PortalGuard)
export class ProfilePortalController {
  private readonly logger = new Logger(ProfilePortalController.name);
  private readonly userinfo: UserinfoClient;

  constructor(@Inject(UserinfoClient) userinfo: UserinfoClient) {
    this.userinfo = userinfo;
  }

  @Get()
  @ApiOkResponse({ description: 'The caller’s profile from userinfo', standardSchema: profileSchema })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token, or Keycloak refused it at userinfo' })
  @ApiForbiddenResponse({ description: 'Not a portal-client person token' })
  @ApiServiceUnavailableResponse({ description: 'Keycloak’s userinfo endpoint is unreachable or answered badly' })
  async profile(@CurrentCaller() caller: Caller): Promise<ProfileResponse> {
    warnOnTokenProfileClaims(this.logger, caller.user.claims);
    const user = await readCallerProfile(this.userinfo, caller, this.logger, 'Your profile is temporarily unavailable');
    return profileView(user.claims);
  }
}
