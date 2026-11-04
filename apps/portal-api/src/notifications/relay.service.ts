import { BadGatewayException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import { describeError } from '../logging/describe-error.js';

/** Upper bound for one relayed call to notification-api. */
export const RELAY_TIMEOUT_MS = 10_000;

export interface RelayRequest {
  method: string;
  /** notification-api path plus query string, e.g. `/api/v1/me/contact-points?page=2`. */
  pathAndQuery: string;
  /** Sent as `Authorization: Bearer …`; omitted for the public confirm route. */
  accessToken?: string;
  /** Sent as JSON when defined. */
  body?: unknown;
}

export interface RelayResponse {
  status: number;
  contentType: string | null;
  body: Buffer;
}

/** Calls notification-api (`NOTIFICATION_API_URL`). Redirects are never followed, so a token never leaves for them. */
@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);
  private readonly baseUrl: string | undefined;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    // A validated `undefined` falls back to the raw env value in ConfigService, so a blank `NOTIFICATION_API_URL=` reads
    // as '' here.
    this.baseUrl = config.get('NOTIFICATION_API_URL', { infer: true }) || undefined;
  }

  /** False when `NOTIFICATION_API_URL` is blank: the relay routes answer 404. */
  get enabled(): boolean {
    return this.baseUrl !== undefined;
  }

  /** Forwards the request and returns notification-api's response; 502 when it can't be reached or redirects. */
  async forward(request: RelayRequest): Promise<RelayResponse> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (request.accessToken !== undefined) headers['authorization'] = `Bearer ${request.accessToken}`;
    if (request.body !== undefined) headers['content-type'] = 'application/json';
    const target = `${this.baseUrl ?? ''}${request.pathAndQuery}`;

    let response: Response;
    let body: Buffer;
    try {
      response = await fetch(target, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        redirect: 'manual',
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      });
      body = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      this.logger.warn({ msg: `Relay to notification-api failed (${request.method})`, error: describeError(error) });
      throw new BadGatewayException('Notifications are temporarily unavailable');
    }
    if (response.status >= 300 && response.status < 400) {
      this.logger.warn({
        msg: `notification-api answered a relayed ${request.method} with a redirect`,
        status: response.status,
      });
      throw new BadGatewayException('Notifications are temporarily unavailable');
    }
    if (response.status >= 500) {
      this.logger.warn({
        msg: `notification-api answered a relayed ${request.method} with an error`,
        status: response.status,
      });
    }
    return { status: response.status, contentType: response.headers.get('content-type'), body };
  }
}
