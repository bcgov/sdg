import { isIP } from 'node:net';

import { Agent, buildConnector, fetch } from 'undici';

import { OUTBOUND_TIMEOUT_MS, type OutboundGuard, type VettedHost } from './outbound-guard.js';
import { ACCEPTED, failed, failedFromError, type SendOutcome } from './outcome.js';

/**
 * An undici dispatcher whose every new connection goes through the guard: the host is vetted and the socket connects
 * to the vetted address, while TLS still verifies the certificate against the original host name (KTD12).
 */
export function createGuardedDispatcher(guard: OutboundGuard, timeoutMs: number): Agent {
  const connector = buildConnector({ timeout: timeoutMs });
  const connectVetted = async (options: buildConnector.Options, callback: buildConnector.Callback) => {
    let vetted: VettedHost;
    try {
      vetted = await guard.vet(options.hostname);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)), null);
      return;
    }
    const servername = options.servername ?? (isIP(vetted.host) === 0 ? vetted.host : undefined);
    connector({ ...options, hostname: vetted.address, ...(servername ? { servername } : {}) }, callback);
  };
  return new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    connect: (options, callback) => void connectVetted(options, callback),
  });
}

export interface HttpPost {
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string;
}

export interface GuardedHttpClientOptions {
  /** The total time a request may take, from connecting to the end of the response. */
  timeoutMs?: number;
}

/** 408, 429 and 5xx may pass on a later attempt; any other non-2xx won't. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Webhook and failure-callback requests (R51): https only except to allow-listed hosts, through the guarded
 * dispatcher, redirects never followed, one total timeout, and the response body discarded unread.
 */
export class GuardedHttpClient {
  readonly timeoutMs: number;
  private readonly guard: OutboundGuard;
  private readonly dispatcher: Agent;

  constructor(guard: OutboundGuard, { timeoutMs = OUTBOUND_TIMEOUT_MS }: GuardedHttpClientOptions = {}) {
    this.guard = guard;
    this.timeoutMs = timeoutMs;
    this.dispatcher = createGuardedDispatcher(guard, timeoutMs);
  }

  async post({ url, headers, body }: HttpPost): Promise<SendOutcome> {
    const problem = this.guard.urlProblem(url);
    if (problem) return failed(false, problem);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        redirect: 'manual',
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      await response.body?.cancel();
      if (response.ok) return ACCEPTED;
      if (response.status >= 300 && response.status < 400) {
        return failed(false, `HTTP ${response.status}: redirect not followed`);
      }
      return failed(isRetryableStatus(response.status), `HTTP ${response.status}`);
    } catch (error) {
      return failedFromError(fetchCause(error));
    }
  }

  close(): Promise<void> {
    return this.dispatcher.close();
  }
}

/** undici's fetch wraps connection errors in a `TypeError: fetch failed` whose cause is the real error. */
function fetchCause(error: unknown): unknown {
  if (error instanceof TypeError && error.message === 'fetch failed' && error.cause !== undefined) return error.cause;
  return error;
}
