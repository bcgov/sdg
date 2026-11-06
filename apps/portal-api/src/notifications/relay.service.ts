import { Readable } from 'node:stream';

import { BadGatewayException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import { describeError } from '../logging/describe-error.js';

/** Upper bound for one relayed call to notification-api; for a stream, for its headers only. */
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

/** An open upstream event stream (a 200 answer to a stream request). */
export interface UpstreamStream {
  contentType: string | null;
  cacheControl: string | null;
  body: Readable;
  /** Aborts the upstream request; the body then errors, so read nothing after calling it. */
  abort: () => void;
}

/** A stream request's outcome: the open stream, or any other answer, relayed like a JSON call. */
export type StreamResult = { kind: 'stream'; stream: UpstreamStream } | { kind: 'response'; response: RelayResponse };

const unavailable = (): BadGatewayException => new BadGatewayException('Notifications are temporarily unavailable');

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

    let response: Response;
    let body: Buffer;
    try {
      response = await this.fetch(request.method, request.pathAndQuery, {
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      });
      body = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      this.logger.warn({ msg: `Relay to notification-api failed (${request.method})`, error: describeError(error) });
      throw unavailable();
    }
    return this.relayed(request.method, response, body);
  }

  /**
   * Opens notification-api's event stream at `pathAndQuery` (KTD6). Only the wait for its headers is timed, so the
   * stream itself stays open for as long as notification-api keeps it. Any answer but 200 maps as `forward` does.
   */
  async stream(pathAndQuery: string, accessToken: string): Promise<StreamResult> {
    const controller = new AbortController();
    const headersTimeout = setTimeout(() => controller.abort(new Error('No headers in time')), RELAY_TIMEOUT_MS);
    let response: Response;
    let body: Buffer;
    try {
      response = await this.fetch('GET', pathAndQuery, {
        headers: { accept: 'text/event-stream', authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      if (response.status === 200 && response.body !== null) {
        const stream: UpstreamStream = {
          contentType: response.headers.get('content-type'),
          cacheControl: response.headers.get('cache-control'),
          body: Readable.fromWeb(response.body),
          abort: () => controller.abort(),
        };
        return { kind: 'stream', stream };
      }
      body = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      this.logger.warn({ msg: 'Relay of the inbox stream failed', error: describeError(error) });
      throw unavailable();
    } finally {
      clearTimeout(headersTimeout);
    }
    return { kind: 'response', response: this.relayed('GET', response, body) };
  }

  private fetch(method: string, pathAndQuery: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl ?? ''}${pathAndQuery}`, { ...init, method, redirect: 'manual' });
  }

  /** notification-api's answer as relayed: 502 for a redirect, 5xx logged and passed through. */
  private relayed(method: string, response: Response, body: Buffer): RelayResponse {
    if (response.status >= 300 && response.status < 400) {
      this.logger.warn({
        msg: `notification-api answered a relayed ${method} with a redirect`,
        status: response.status,
      });
      throw unavailable();
    }
    if (response.status >= 500) {
      this.logger.warn({ msg: `notification-api answered a relayed ${method} with an error`, status: response.status });
    }
    return { status: response.status, contentType: response.headers.get('content-type'), body };
  }
}
