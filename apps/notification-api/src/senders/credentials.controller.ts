import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { OwnerGuard } from '../auth/owner.guard.js';
import { BEARER_AUTH } from '../openapi/swagger.js';
import { CredentialsService } from './credentials.service.js';
import {
  credentialListSchema,
  credentialParamsSchema,
  credentialSchema,
  linkCredentialSchema,
  senderParamsSchema,
  setScopesSchema,
  type CredentialParams,
  type CredentialResponse,
  type LinkCredential,
  type SenderParams,
  type SetScopes,
} from './senders.schemas.js';

/** A sender's credentials (R7, R8): linked Keycloak service-account clients and the types each may send. */
@ApiTags('senders')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(OwnerGuard)
@Controller({ path: 'senders/:senderId/credentials', version: '1' })
export class CredentialsController {
  private readonly credentials: CredentialsService;

  constructor(@Inject(CredentialsService) credentials: CredentialsService) {
    this.credentials = credentials;
  }

  @Post()
  @ApiCreatedResponse({
    description: 'The linked credential, with no scoped types yet',
    standardSchema: credentialSchema,
  })
  link(
    @Param({ schema: senderParamsSchema }) { senderId }: SenderParams,
    @Body({ schema: linkCredentialSchema }) { clientId }: LinkCredential,
  ): Promise<CredentialResponse> {
    return this.credentials.link(senderId, clientId);
  }

  @Get()
  @ApiOkResponse({ description: "The sender's credentials", standardSchema: credentialListSchema })
  list(@Param({ schema: senderParamsSchema }) { senderId }: SenderParams): Promise<CredentialResponse[]> {
    return this.credentials.list(senderId);
  }

  @Get(':credentialId')
  @ApiOkResponse({ description: 'The credential', standardSchema: credentialSchema })
  get(
    @Param({ schema: credentialParamsSchema }) { senderId, credentialId }: CredentialParams,
  ): Promise<CredentialResponse> {
    return this.credentials.get(senderId, credentialId);
  }

  @Put(':credentialId/scopes')
  @ApiOkResponse({ description: 'The credential with its new scope', standardSchema: credentialSchema })
  setScopes(
    @Param({ schema: credentialParamsSchema }) { senderId, credentialId }: CredentialParams,
    @Body({ schema: setScopesSchema }) { typeKeys }: SetScopes,
  ): Promise<CredentialResponse> {
    return this.credentials.setScopes(senderId, credentialId, typeKeys);
  }

  @Delete(':credentialId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The client is no longer a credential' })
  unlink(@Param({ schema: credentialParamsSchema }) { senderId, credentialId }: CredentialParams): Promise<void> {
    return this.credentials.unlink(senderId, credentialId);
  }
}
