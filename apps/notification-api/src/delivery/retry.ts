import type { SendOutcome } from '../outbound/outcome.js';

/** KTD17: at most 6 attempts, backing off from 30 seconds, doubling, capped at an hour. */
export const MAX_ATTEMPTS = 6;

/** A claim beyond the last attempt: a crashed worker's last try being reclaimed. */
export const isReclaimedFinalAttempt = (attempts: number): boolean => attempts > MAX_ATTEMPTS;
export const FIRST_BACKOFF_MS = 30_000;
export const MAX_BACKOFF_MS = 60 * 60_000;

/** The wait after failed attempt number `attempt` (1-based). */
export function backoffMs(attempt: number): number {
  return Math.min(FIRST_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

/** Why a delivery or callback ended `failed` (R54). */
export const FAILURE_REASONS = {
  exhausted: 'attempts exhausted',
  permanent: 'permanent failure',
  noIntegration: 'no usable integration',
  renderFailed: 'render failed',
} as const;

export type RetryDecision =
  | { readonly kind: 'done' }
  | { readonly kind: 'retry'; readonly dueAt: Date }
  | { readonly kind: 'fail'; readonly reason: string };

/** What follows attempt number `attempt`: done once accepted, a retry while one may pass and attempts remain. */
export function afterAttempt(outcome: SendOutcome, attempt: number, now: Date): RetryDecision {
  if (outcome.status === 'accepted') return { kind: 'done' };
  if (!outcome.retryable) return { kind: 'fail', reason: FAILURE_REASONS.permanent };
  if (attempt >= MAX_ATTEMPTS) return { kind: 'fail', reason: FAILURE_REASONS.exhausted };
  return { kind: 'retry', dueAt: new Date(now.getTime() + backoffMs(attempt)) };
}
