import { OutboundBlockedError } from './outbound-guard.js';

/**
 * What one outbound send came to. A failure carries a short error for history, never a response body (R51), and
 * whether trying again could succeed.
 */
export type SendOutcome = { readonly status: 'accepted' } | SendFailure;

export interface SendFailure {
  readonly status: 'failed';
  readonly retryable: boolean;
  readonly error: string;
}

const MAX_ERROR_LENGTH = 200;

export function failed(retryable: boolean, error: string): SendFailure {
  const short = error.length > MAX_ERROR_LENGTH ? `${error.slice(0, MAX_ERROR_LENGTH - 1)}…` : error;
  return { status: 'failed', retryable, error: short };
}

export const ACCEPTED: SendOutcome = { status: 'accepted' };

/** A blocked destination is permanent; anything else thrown on the way (DNS, connection) may pass. */
export function failedFromError(error: unknown): SendFailure {
  if (error instanceof OutboundBlockedError) return failed(false, error.message);
  if (!(error instanceof Error)) return failed(true, String(error));
  const code: unknown = Reflect.get(error, 'code');
  return failed(true, typeof code === 'string' ? `${code}: ${error.message}` : error.message);
}
