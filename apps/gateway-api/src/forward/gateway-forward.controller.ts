import { STATUS_CODES } from 'node:http';

import { All, Controller, Inject, Logger, Req, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Forwarder, type ForwardResult, type TokenResult } from '@repo/server-core/forwarding';
import type { Request, Response } from 'express';

import type { Env } from '../config/env.js';

/** The only shape core-api accepts (its principal resolver), so a token that passes here is forwarded byte for byte. */
const BEARER = /^Bearer ([A-Za-z0-9\-_.~+/]+=*)$/;

/** The token from a `Bearer <token>` Authorization header, or 401 for anything else: no upstream call. */
export function bearerToken(authorization: string | undefined): TokenResult {
  const token = authorization === undefined ? undefined : BEARER.exec(authorization)?.[1];
  return token === undefined ? { status: 401 } : { token };
}

/** Headers a local refusal must carry (RFC 9110 §15.5.2, §15.5.6). */
const REFUSAL_HEADERS: Readonly<Record<number, Readonly<Record<string, string>>>> = {
  401: { 'www-authenticate': 'Bearer' },
  405: { allow: 'GET' },
};

/**
 * Forwards service accounts' GET `/api/v<N>/gateway/…` calls to core-api with the caller's own Bearer token, which
 * core-api verifies and checks against the registry (KTD12). Any other path is 404 and any other method 405 (R19),
 * a missing or non-Bearer Authorization 401, all without contacting core-api; core-api unreachable is 503. core-api's
 * answers, its 401 and 403 included, are relayed unchanged.
 */
@ApiExcludeController()
@Controller({ version: VERSION_NEUTRAL })
export class GatewayForwardController {
  private readonly logger = new Logger(GatewayForwardController.name);
  private readonly forwarder: Forwarder<Request>;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.forwarder = new Forwarder<Request>({
      upstream: config.get('CORE_API_URL', { infer: true }),
      audiences: ['gateway'],
      methods: ['GET'],
      token: async (req) => bearerToken(req.headers.authorization),
      logger: this.logger,
    });
  }

  @All('*path')
  async forward(@Req() req: Request, @Res() res: Response): Promise<void> {
    const result = await this.forwarder.forward(
      { method: req.method, url: req.originalUrl, headers: req.headers },
      req,
    );
    send(res, result);
  }
}

function send(res: Response, result: ForwardResult): void {
  if (result.kind === 'rejected') {
    res.set(REFUSAL_HEADERS[result.status] ?? {});
    res.status(result.status).json({ statusCode: result.status, message: STATUS_CODES[result.status] ?? 'Error' });
    return;
  }
  res.status(result.status);
  for (const [name, value] of result.headers) res.setHeader(name, value);
  res.end(result.body);
}
