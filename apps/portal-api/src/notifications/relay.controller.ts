import {
  All,
  Body,
  Controller,
  Inject,
  Injectable,
  NotFoundException,
  Post,
  Req,
  Res,
  UseGuards,
  type CanActivate,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { SESSION_COOKIE } from '../session/session.module.js';
import { RelayService, type RelayResponse } from './relay.service.js';
import { TokenRefreshService } from './token-refresh.service.js';

/** Where the recipient relay is mounted, and notification-api's recipient endpoints it forwards to. */
const RELAY_PREFIX = '/api/v1/notifications';
const RECIPIENT_PREFIX = '/api/v1/me';

const confirmBodySchema = z.object({
  token: z.string().min(1).max(200).meta({ description: 'The token from the confirmation link' }),
});
type ConfirmBody = z.infer<typeof confirmBodySchema>;

/** 404 for every relay route while `NOTIFICATION_API_URL` is blank. Runs before the session guard. */
@Injectable()
export class RelayEnabledGuard implements CanActivate {
  private readonly relay: RelayService;

  constructor(@Inject(RelayService) relay: RelayService) {
    this.relay = relay;
  }

  canActivate(): boolean {
    if (!this.relay.enabled) throw new NotFoundException();
    return true;
  }
}

function send(res: Response, upstream: RelayResponse): void {
  res.status(upstream.status);
  if (upstream.contentType !== null) res.set('content-type', upstream.contentType);
  res.send(upstream.body);
}

/** `/api/v1/notifications/<rest>` → `/api/v1/me/<rest>`, or null for a path that would resolve outside it. */
function recipientPath(originalUrl: string): string | null {
  // URL parsing resolves dot segments (also percent-encoded ones), so `/notifications/%2e%2e/admin` leaves the prefix.
  const { pathname, search } = new URL(originalUrl, 'http://portal-api.invalid');
  if (pathname !== RELAY_PREFIX && !pathname.startsWith(`${RELAY_PREFIX}/`)) return null;
  return `${RECIPIENT_PREFIX}${pathname.slice(RELAY_PREFIX.length)}${search}`;
}

/**
 * Relays the signed-in user's calls to notification-api's recipient endpoints (R56) with the session's access token,
 * refreshed first when it is about to expire (KTD16). Status, content type and body come back unchanged.
 */
@ApiTags('notifications')
@ApiCookieAuth(SESSION_COOKIE)
@Controller({ path: 'notifications', version: '1' })
@UseGuards(RelayEnabledGuard, SessionAuthGuard)
export class RelayController {
  private readonly relay: RelayService;
  private readonly tokens: TokenRefreshService;

  constructor(@Inject(RelayService) relay: RelayService, @Inject(TokenRefreshService) tokens: TokenRefreshService) {
    this.relay = relay;
    this.tokens = tokens;
  }

  @All(['', '*path'])
  @ApiOkResponse({ description: "notification-api's response for the matching /api/v1/me endpoint" })
  @ApiUnauthorizedResponse({ description: 'No authenticated session, or the token refresh failed (session ended)' })
  @ApiBadGatewayResponse({ description: 'notification-api is unreachable' })
  @ApiNotFoundResponse({ description: 'The relay is disabled (NOTIFICATION_API_URL is blank)' })
  async relayRecipient(@Req() req: Request, @Res() res: Response): Promise<void> {
    const pathAndQuery = recipientPath(req.originalUrl);
    if (pathAndQuery === null) throw new NotFoundException();
    const accessToken = await this.tokens.accessToken(req);
    const body: unknown = req.body;
    send(res, await this.relay.forward({ method: req.method, pathAndQuery, accessToken, body }));
  }
}

/** The public confirm route for portal-web's confirm-email page (R35, KTD15): no session, the token is the proof. */
@ApiTags('notifications')
@Controller({ path: 'contact-points', version: '1' })
@UseGuards(RelayEnabledGuard)
export class ConfirmRelayController {
  private readonly relay: RelayService;

  constructor(@Inject(RelayService) relay: RelayService) {
    this.relay = relay;
  }

  @Post('confirm')
  @ApiNoContentResponse({ description: 'Confirmed' })
  @ApiBadRequestResponse({ description: 'The token is invalid, already used or expired' })
  @ApiBadGatewayResponse({ description: 'notification-api is unreachable' })
  async confirm(@Body({ schema: confirmBodySchema }) body: ConfirmBody, @Res() res: Response): Promise<void> {
    send(res, await this.relay.forward({ method: 'POST', pathAndQuery: '/api/v1/contact-points/confirm', body }));
  }
}
