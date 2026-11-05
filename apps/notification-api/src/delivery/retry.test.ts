import { describe, expect, it } from 'vitest';

import { failed, type SendOutcome } from '../outbound/outcome.js';
import { afterAttempt, backoffMs, isReclaimedFinalAttempt } from './retry.js';

const NOW = new Date('2027-01-05T18:00:00Z');
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

describe('retry bounds (KTD17)', () => {
  it.each([
    [1, 30],
    [2, 60],
    [3, 120],
    [5, 480],
    [7, 1920],
    [8, 3600],
    [20, 3600],
  ])('waits %i failed attempt(s) out for %i seconds, doubling from 30 and capped at an hour', (attempt, seconds) => {
    expect(backoffMs(attempt)).toBe(seconds * 1000);
  });

  it.each([
    [1, false],
    [6, false],
    [7, true],
    [8, true],
  ])('treats claim number %i as a reclaimed final attempt: %s', (attempts, reclaimed) => {
    expect(isReclaimedFinalAttempt(attempts)).toBe(reclaimed);
  });

  const retryable = failed(true, 'HTTP 503');
  const permanent = failed(false, 'HTTP 400');
  const accepted: SendOutcome = { status: 'accepted' };
  it.each([
    ['an accepted send', accepted, 6, { kind: 'done' }],
    ['a permanent failure', permanent, 1, { kind: 'fail', reason: 'permanent failure' }],
    ['a retryable failure on attempt 1', retryable, 1, { kind: 'retry', dueAt: later(30) }],
    ['a retryable failure on attempt 5', retryable, 5, { kind: 'retry', dueAt: later(480) }],
    ['a retryable failure on attempt 6', retryable, 6, { kind: 'fail', reason: 'attempts exhausted' }],
  ] as const)('decides what follows %s', (_name, outcome, attempt, decision) => {
    expect(afterAttempt(outcome, attempt, NOW)).toEqual(decision);
  });
});
