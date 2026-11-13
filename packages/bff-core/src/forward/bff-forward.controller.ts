import { STATUS_CODES } from 'node:http';

import { All, Controller, Inject, Logger, Next, Req, Res, VERSION_NEUTRAL, type RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { describeError } from '@repo/server-core';
import {
  classifyPath,
  Forwarder,
  normalizeRequestTarget,
  type ForwardResult,
  type TokenResult,
} from '@repo/server-core/forwarding';
import type { NextFunction, Request, Response } from 'express';

import { BFF_OPTIONS, type BffModuleOptions } from '../nestjs/bff.options.js';
import { TokenRefreshService } from '../refresh/token-refresh.service.js';
import { requestBody } from './request-body.js';

interface ForwardContext {
  readonly req: Request;
  readonly res: Response;
  /** A GET to one of `optionalSessionPaths`: forwarded with no token when there is no usable session. */
  readonly sessionOptional: boolean;
  /** Set by the token supplier when the call goes to core-api with no token. */
  anonymous: boolean;
}

/**
 * The decoded, normalized path of a `/api/v<N>/<audience>/…` target, without a trailing slash, or undefined for
 * anything else, which is left to the app's other routes (or its 404).
 */
function forwardedPath(url: string): string | undefined {
  const target = normalizeRequestTarget(url);
  if (target === undefined || classifyPath(target.path) === undefined) return undefined;
  return target.path.endsWith('/') ? target.path.slice(0, -1) : target.path;
}

/**
 * Forwards the signed-in user's `/api/v<N>/<audience>/…` calls to core-api with the session's access token,
 * refreshed first when it is about to expire. Paths outside this BFF's audiences get 404, a missing session 401,
 * an unreachable IdP or core-api 503. A 401 from core-api ends the session: the BFF just sent a token it believed valid.
 * A GET to one of `optionalSessionPaths` with no session, or whose session just ended, is forwarded with no token
 * instead of 401 (KTD2), and a 401 from core-api to it is relayed as is.
 */
@ApiExcludeController()
@Controller({ version: VERSION_NEUTRAL })
export class BffForwardController {
  private readonly logger = new Logger(BffForwardController.name);
  private readonly refresh: TokenRefreshService;
  private readonly cookieName: string;
  private readonly optionalSessionPaths: ReadonlySet<string>;
  private readonly forwarder: Forwarder<ForwardContext>;

  constructor(
    @Inject(BFF_OPTIONS) options: BffModuleOptions,
    @Inject(TokenRefreshService) refresh: TokenRefreshService,
  ) {
    this.refresh = refresh;
    this.cookieName = options.session.cookieName;
    this.optionalSessionPaths = new Set(options.optionalSessionPaths);
    this.forwarder = new Forwarder<ForwardContext>({
      upstream: options.coreApiUrl,
      audiences: [...options.audiences, 'shared'],
      token: (context) => this.token(context),
      logger: this.logger,
    });
  }

  @All('*path')
  async forward(@Req() req: RawBodyRequest<Request>, @Res() res: Response, @Next() next: NextFunction): Promise<void> {
    // Registered as a catch-all under /api, so it must not shadow routes the app registers after it.
    const path = forwardedPath(req.originalUrl);
    if (path === undefined) return next();
    let body: Uint8Array | undefined;
    try {
      body = await requestBody(req);
    } catch (error) {
      this.logger.error({ msg: 'Could not read the request body to forward', error: describeError(error) });
      throw error;
    }
    const context: ForwardContext = {
      req,
      res,
      sessionOptional: req.method === 'GET' && this.optionalSessionPaths.has(path),
      anonymous: false,
    };
    const result = await this.forwarder.forward(
      { method: req.method, url: req.originalUrl, headers: req.headers, body },
      context,
    );
    if (result.kind === 'response' && result.status === 401 && !context.anonymous) {
      return this.rejectedByCoreApi(req, res);
    }
    this.send(res, result);
  }

  private async token(context: ForwardContext): Promise<TokenResult> {
    const result = await this.refresh.accessToken(context.req);
    if (result.kind === 'token') return { token: result.token };
    if (result.kind === 'unavailable') return { status: 503 };
    if (result.kind === 'ended') context.res.clearCookie(this.cookieName, { path: '/' });
    if (!context.sessionOptional) return { status: 401 };
    context.anonymous = true;
    return { anonymous: true };
  }

  private async rejectedByCoreApi(req: Request, res: Response): Promise<void> {
    this.logger.error({
      msg: 'core-api rejected the session access token; ending the session',
      method: req.method,
      path: req.path,
    });
    await this.refresh.endSession(req);
    res.clearCookie(this.cookieName, { path: '/' });
    this.send(res, { kind: 'rejected', status: 401 });
  }

  private send(res: Response, result: ForwardResult): void {
    if (result.kind === 'rejected') {
      res.status(result.status).json({ statusCode: result.status, message: STATUS_CODES[result.status] ?? 'Error' });
      return;
    }
    res.status(result.status);
    for (const [name, value] of result.headers) res.setHeader(name, value);
    res.end(result.body);
  }
}
