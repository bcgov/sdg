import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Res, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { CredentialGuard } from '../auth/credential.guard.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import type { Principal } from '../auth/token-kind.js';
import { BEARER_AUTH } from '../openapi/swagger.js';
import {
  SEND_BODY_LIMIT,
  sendResponseSchema,
  sendSchema,
  type SendRequest,
  type SendResponse,
} from './send.schemas.js';
import { SendService } from './send.service.js';

/** Credential endpoint (R26): send a Notification type to recipients, a topic or everyone. */
@ApiTags('notifications')
@ApiBearerAuth(BEARER_AUTH)
@UseGuards(CredentialGuard)
@Controller({ path: 'notifications', version: '1' })
export class SendController {
  private readonly sends: SendService;

  constructor(@Inject(SendService) sends: SendService) {
    this.sends = sends;
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'Stored; workers deliver it', standardSchema: sendResponseSchema })
  @ApiOkResponse({
    description: 'A replay of an idempotency key with the same body: the original notification',
    standardSchema: sendResponseSchema,
  })
  @ApiBadRequestResponse({ description: 'The data, a policy channel, the topic or a recipient failed a check (R28)' })
  @ApiForbiddenResponse({ description: 'The credential is not scoped to the type' })
  @ApiConflictResponse({ description: 'The idempotency key was already used with a different body' })
  @ApiPayloadTooLargeResponse({ description: `The body is over ${SEND_BODY_LIMIT}` })
  async send(
    @CurrentPrincipal() principal: Principal,
    @Body({ schema: sendSchema }) request: SendRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SendResponse> {
    if (principal.kind !== 'credential') throw new Error('Send route reached without a credential');
    const { response, replayed } = await this.sends.send(principal.credential, request);
    if (replayed) res.status(HttpStatus.OK);
    return response;
  }
}
