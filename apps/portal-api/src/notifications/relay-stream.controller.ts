import { Controller, Get, Inject, Logger, Req, Res, UseGuards, type BeforeApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadGatewayResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { SessionData } from 'express-session';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { Env } from '../config/env.js';
import { describeError } from '../logging/describe-error.js';
import { idleExpired } from '../session/activity.middleware.js';
import { SESSION_COOKIE } from '../session/session.module.js';
import { RelayEnabledGuard, send } from './relay.controller.js';
import { RelayService, type UpstreamStream } from './relay.service.js';
import { TokenRefreshService } from './token-refresh.service.js';

export { RELAY_STREAM_PATH } from './relay-stream.path.js';
/** notification-api's per-user inbox stream (U4). */
const UPSTREAM_STREAM_PATH = '/api/v1/me/inbox/stream';
/** The comment notification-api sends every 15 seconds; each one re-checks the session. */
const KEEP_ALIVE = ': keep-alive';

/** Whether a stored session may keep its stream open: it still holds a completed login and is not idle-expired. */
function sessionActive(session: SessionData | null | undefined, ttlSeconds: number): boolean {
  return session?.auth !== undefined && !idleExpired(session, ttlSeconds);
}

/** The request's session as stored now; `req.session` is this request's copy, loaded when the stream opened. */
function storedSession(req: Request): Promise<SessionData | null | undefined> {
  return new Promise((resolve, reject) => {
    req.sessionStore.get(req.sessionID, (error: unknown, session?: SessionData | null) => {
      if (!error) resolve(session);
      else reject(error instanceof Error ? error : new Error('Session read failed', { cause: error }));
    });
  });
}

/** True for each piped chunk that completes a keep-alive comment, also one split across chunks. */
function keepAliveScanner(): (chunk: Buffer) => boolean {
  let tail = '';
  return (chunk) => {
    const text = tail + chunk.toString('latin1');
    // Shorter than the comment, so a match always takes at least one byte of the new chunk and counts once.
    tail = text.slice(-(KEEP_ALIVE.length - 1));
    return text.includes(KEEP_ALIVE);
  };
}

/**
 * Relays the signed-in user's live inbox stream from notification-api (KTD6) without buffering or a total timeout.
 * Declared ahead of the JSON relay's catch-all. The stream ends when notification-api ends it, when the browser goes
 * away, at the first keep-alive after the session ends (R28), and on shutdown.
 */
@ApiTags('notifications')
@ApiCookieAuth(SESSION_COOKIE)
@Controller({ path: 'notifications/inbox', version: '1' })
@UseGuards(RelayEnabledGuard, SessionAuthGuard)
export class RelayStreamController implements BeforeApplicationShutdown {
  private readonly logger = new Logger(RelayStreamController.name);
  private readonly relay: RelayService;
  private readonly tokens: TokenRefreshService;
  /** The idle limit, `SESSION_TTL_SECONDS`. */
  private readonly ttlSeconds: number;
  /** Ends each open stream. */
  private readonly open = new Set<() => void>();

  constructor(
    @Inject(RelayService) relay: RelayService,
    @Inject(TokenRefreshService) tokens: TokenRefreshService,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.relay = relay;
    this.tokens = tokens;
    this.ttlSeconds = config.get('SESSION_TTL_SECONDS', { infer: true });
  }

  @Get('stream')
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'Server-Sent Events from notification-api: `changed` whenever your inbox changes' })
  @ApiUnauthorizedResponse({ description: 'No authenticated session, or notification-api rejected the token' })
  @ApiBadGatewayResponse({ description: 'notification-api or the identity provider is unreachable' })
  @ApiNotFoundResponse({ description: 'The relay is disabled (NOTIFICATION_API_URL is blank)' })
  async stream(@Req() req: Request, @Res() res: Response): Promise<void> {
    const accessToken = await this.tokens.accessToken(req);
    const result = await this.relay.stream(UPSTREAM_STREAM_PATH, accessToken);
    if (result.kind === 'response') send(res, result.response);
    else this.pipe(req, res, result.stream);
  }

  /** Ends every piped stream, so the HTTP server can close and browsers reconnect to another instance. */
  beforeApplicationShutdown(): void {
    for (const end of this.open) end();
  }

  private pipe(req: Request, res: Response, upstream: UpstreamStream): void {
    let ended = false;
    const end = (): void => {
      if (ended) return;
      ended = true;
      this.open.delete(end);
      upstream.abort();
      if (!res.writableEnded && !res.destroyed) res.end();
    };
    const sawKeepAlive = keepAliveScanner();
    this.open.add(end);
    res.on('close', end);
    upstream.body.on('data', (chunk: Buffer) => {
      if (ended) return;
      res.write(chunk);
      if (sawKeepAlive(chunk)) void this.recheck(req, end);
    });
    upstream.body.on('end', end);
    upstream.body.on('error', (error: unknown) => {
      if (ended) return;
      this.logger.warn({ msg: 'Inbox stream from notification-api failed', error: describeError(error) });
      end();
    });

    const headers: Record<string, string> = { 'x-accel-buffering': 'no' };
    if (upstream.contentType !== null) headers['content-type'] = upstream.contentType;
    if (upstream.cacheControl !== null) headers['cache-control'] = upstream.cacheControl;
    res.writeHead(200, headers);
  }

  /** Ends the stream when its session is gone (sign-out, expiry) or idle-expired, or when the store can't tell. */
  private async recheck(req: Request, end: () => void): Promise<void> {
    try {
      if (!sessionActive(await storedSession(req), this.ttlSeconds)) end();
    } catch (error) {
      this.logger.warn({ msg: 'Inbox stream session re-check failed; ending the stream', error: describeError(error) });
      end();
    }
  }
}
