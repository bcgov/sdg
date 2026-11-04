import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';

import { confirmSchema, type Confirm } from './recipients.schemas.js';
import { VerificationService } from './verification.service.js';

/**
 * The public confirm endpoint (KTD15): no token guard, since the token in the body is the proof. portal-web's
 * confirm page posts it through portal-api when the user presses its button, so a mail scanner fetching the link
 * confirms nothing.
 */
@ApiTags('contact-points')
@Controller({ path: 'contact-points', version: '1' })
export class ConfirmController {
  private readonly verification: VerificationService;

  constructor(@Inject(VerificationService) verification: VerificationService) {
    this.verification = verification;
  }

  @Post('confirm')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Confirmed; 400 for a token that is invalid, already used or expired' })
  async confirm(@Body({ schema: confirmSchema }) { token }: Confirm): Promise<void> {
    await this.verification.confirm(token);
  }
}
