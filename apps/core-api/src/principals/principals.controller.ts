import {
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Logger,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
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
import type { AuthUser } from '@repo/auth';
import { describeError } from '@repo/server-core';

import { InternalGuard } from '../auth/audience.guards.js';
import type { Caller } from '../auth/caller.js';
import { CurrentCaller } from '../auth/current-caller.decorator.js';
import { UserinfoClient, UserinfoError } from '../auth/userinfo.client.js';
import { loginResponseSchema, type LoginResponse } from './principals.schemas.js';
import { PrincipalsService } from './principals.service.js';

/**
 * The BFFs' sign-in step (KTD5, R11): after the code exchange, the BFF sends the fresh access token and core-api
 * creates or refreshes the caller's principal. Outside /api, so no forwarder ever reaches it (KTD2).
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
  @ApiForbiddenResponse({ description: 'An admin-client token without the admin client role, or a service account' })
  @ApiServiceUnavailableResponse({ description: 'Keycloak’s signing keys or userinfo endpoint are unreachable' })
  async login(@CurrentCaller() caller: Caller): Promise<LoginResponse> {
    // KTD6: the admin role gate. Nothing is read or created for a refused admin (AE1).
    if (caller.kind === 'admin-user' && !caller.isAdmin) {
      throw new ForbiddenException('The admin client role is required');
    }
    const profile = await this.profile(caller);
    const { principalId } = await this.principals.upsertFromLogin(profile);
    return { principalId, name: profile.name, email: profile.email };
  }

  /** The caller's profile from userinfo; its failures become 401 (Keycloak refused the token) or 503. */
  private async profile(caller: Caller): Promise<AuthUser> {
    try {
      return await this.userinfo.profile(caller.token, caller.user);
    } catch (error) {
      if (!(error instanceof UserinfoError)) throw error;
      if (error.reason === 'rejected') {
        this.logger.warn({ msg: 'Keycloak refused a verified token at userinfo', error: describeError(error) });
        throw new UnauthorizedException();
      }
      this.logger.error({ msg: 'Could not read the caller’s profile from userinfo', error: describeError(error) });
      throw new ServiceUnavailableException('Sign-in is temporarily unavailable');
    }
  }
}
