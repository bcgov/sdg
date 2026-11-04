import type { deliveries } from '../database/schema/index.js';
import type { SendOutcome } from '../outbound/outcome.js';
import type { RenderedParts } from '../templates/renderer.js';
import type { ClaimedDelivery } from './claimer.js';
import { afterAttempt } from './retry.js';

/** What one try at a delivery recorded about the send (R43, KTD9). */
export interface AttemptRecord {
  readonly integrationId: string | null;
  readonly integrationVersion: string | null;
  readonly rendered: RenderedParts | null;
  readonly status: 'accepted' | 'failed';
  readonly error: string | null;
}

/** What working on a claimed delivery came to, before it is recorded. */
export type AttemptResult =
  /** No attempt was made: the delivery ends with a reason (R54). */
  | { readonly kind: 'cancelled'; readonly reason: string }
  | { readonly kind: 'skipped'; readonly reason: string }
  /** Quiet hours: it waits until `until` without counting an attempt (R40). */
  | { readonly kind: 'held'; readonly until: Date }
  /** It fails without a retry, with the attempt that found out when there was one (KTD9). */
  | { readonly kind: 'failed'; readonly reason: string; readonly attempt: AttemptRecord | null }
  | { readonly kind: 'sent'; readonly outcome: SendOutcome; readonly attempt: AttemptRecord };

type DeliveryUpdate = Partial<typeof deliveries.$inferInsert>;

/** How the delivery row changes, and what else recording it does. */
export interface Transition {
  readonly set: DeliveryUpdate;
  readonly attempt: AttemptRecord | null;
  /** The delivery reached a final status, which may let the next escalation step start (KTD8). */
  readonly final: boolean;
  /** It failed: the sender's failure callback is queued (R42). */
  readonly callback: boolean;
}

function ended(status: 'delivered' | 'failed' | 'cancelled' | 'skipped', reason: string | null, now: Date) {
  return { status, reason, finishedAt: now, leaseUntil: null, updatedAt: now };
}

/** The row change a result makes (R54's transitions out of `sending`). Holds and skips give back their claim's attempt. */
export function transition(claimed: ClaimedDelivery, result: AttemptResult, now: Date): Transition {
  const notAnAttempt = { attempts: claimed.attempts - 1 };
  if (result.kind === 'cancelled' || result.kind === 'skipped') {
    const set = { ...ended(result.kind, result.reason, now), ...notAnAttempt };
    return { set, attempt: null, final: true, callback: false };
  }
  if (result.kind === 'held') {
    const set = {
      status: 'scheduled',
      dueAt: result.until,
      leaseUntil: null,
      updatedAt: now,
      ...notAnAttempt,
    } as const;
    return { set, attempt: null, final: false, callback: false };
  }
  if (result.kind === 'failed') {
    return { set: ended('failed', result.reason, now), attempt: result.attempt, final: true, callback: true };
  }
  const decision = afterAttempt(result.outcome, claimed.attempts, now);
  if (decision.kind === 'done') {
    return { set: ended('delivered', null, now), attempt: result.attempt, final: true, callback: false };
  }
  if (decision.kind === 'retry') {
    const set = { status: 'scheduled', dueAt: decision.dueAt, leaseUntil: null, updatedAt: now } as const;
    return { set, attempt: result.attempt, final: false, callback: false };
  }
  return { set: ended('failed', decision.reason, now), attempt: result.attempt, final: true, callback: true };
}
