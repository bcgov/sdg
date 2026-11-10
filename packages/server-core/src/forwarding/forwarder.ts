import { describeError } from '../describe-error.js';
import { forwardedRequestHeaders, relayedResponseHeaders, type IncomingHeaders } from './headers.js';
import { normalizeRequestTarget } from './normalize.js';
import { classifyPath, type Audience } from './routes.js';

/** Upper bound for one forwarded call to core-api, response body included. */
export const FORWARD_TIMEOUT_MS = 10_000;

/** A token to forward with, or the status to answer instead (e.g. 401 with no session, 503 with the IdP down). */
export type TokenResult = { readonly token: string } | { readonly status: number };

/** Satisfied by Nest's `Logger`; entries follow the repo's `{ msg, error: describeError(error) }` shape. */
export interface ForwarderLogger {
  warn(entry: { msg: string; [key: string]: unknown }): void;
}

export interface ForwarderOptions<C> {
  /** core-api's base URL, without a trailing slash; the request target is appended unchanged. */
  readonly upstream: string;
  /** The audiences this caller forwards (R4); any other path is answered 404 without contacting core-api. */
  readonly audiences: readonly Audience[];
  /** Upper-case methods this caller forwards; others get 405. Every method when omitted. */
  readonly methods?: readonly string[];
  /** Supplies the Bearer token for a request, from the caller's context (a session, an Authorization header). */
  readonly token: (context: C) => Promise<TokenResult>;
  readonly logger: ForwarderLogger;
  /** Defaults to FORWARD_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Defaults to the global fetch. */
  readonly fetch?: typeof fetch;
}

export interface ForwardRequest {
  readonly method: string;
  /** The origin-form request target as received, e.g. Express `req.originalUrl`. */
  readonly url: string;
  readonly headers: IncomingHeaders;
  readonly body?: Uint8Array | string;
}

/** Either a local answer (core-api not contacted, or unavailable) or core-api's response to relay. */
export type ForwardResult =
  | { readonly kind: 'rejected'; readonly status: number }
  | { readonly kind: 'response'; readonly status: number; readonly headers: Headers; readonly body: Uint8Array };

const rejected = (status: number): ForwardResult => ({ kind: 'rejected', status });

/**
 * Forwards a caller's request to core-api (KTD3), framework-agnostic: decides from the path, method and token whether
 * to forward at all, then calls core-api with `redirect: 'manual'` and a timeout. Redirects and error statuses are
 * relayed as they are; core-api unreachable or timed out is 503.
 */
export class Forwarder<C> {
  private readonly options: ForwarderOptions<C>;
  private readonly audiences: ReadonlySet<Audience>;
  private readonly methods: ReadonlySet<string> | undefined;

  constructor(options: ForwarderOptions<C>) {
    this.options = options;
    this.audiences = new Set(options.audiences);
    this.methods = options.methods === undefined ? undefined : new Set(options.methods);
  }

  async forward(request: ForwardRequest, context: C): Promise<ForwardResult> {
    const target = normalizeRequestTarget(request.url);
    const audience = target === undefined ? undefined : classifyPath(target.path);
    if (target === undefined || audience === undefined || !this.audiences.has(audience)) return rejected(404);
    const method = request.method.toUpperCase();
    if (this.methods !== undefined && !this.methods.has(method)) return rejected(405);
    const token = await this.options.token(context);
    if (!('token' in token)) return rejected(token.status);
    return this.call(method, target.target, {
      ...request,
      headers: forwardedRequestHeaders(request.headers, token.token),
    });
  }

  private async call(
    method: string,
    target: string,
    request: Omit<ForwardRequest, 'headers'> & { headers: Headers },
  ): Promise<ForwardResult> {
    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs ?? FORWARD_TIMEOUT_MS;
    const timer = setTimeout(
      () => controller.abort(new Error(`core-api did not answer within ${timeoutMs} ms`)),
      timeoutMs,
    );
    try {
      const response = await (this.options.fetch ?? fetch)(`${this.options.upstream}${target}`, {
        method,
        headers: request.headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
        redirect: 'manual',
        signal: controller.signal,
      });
      const body = new Uint8Array(await response.arrayBuffer());
      if (response.status >= 500) {
        this.options.logger.warn({
          msg: `core-api answered a forwarded ${method} with an error`,
          status: response.status,
        });
      }
      return { kind: 'response', status: response.status, headers: relayedResponseHeaders(response.headers), body };
    } catch (error) {
      this.options.logger.warn({ msg: `Forwarding ${method} to core-api failed`, error: describeError(error) });
      return rejected(503);
    } finally {
      clearTimeout(timer);
    }
  }
}
