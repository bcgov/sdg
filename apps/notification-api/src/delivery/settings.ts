/** What the delivery engine reads the time from, so tests can move it (quiet hours, delays, leases, backoff). */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = { now: () => new Date() };

/** The workers' tuning. */
export interface DeliverySettings {
  /** Rows a worker claims per poll: small, so one worker never holds much work under a lease. */
  readonly batchSize: number;
  /** NOTIFICATION_WORKER_POLL_MS: the wait between polls that found less than a full batch. */
  readonly pollIntervalMs: number;
  /** The total timeout of every outbound call (SMTP, webhook, callback). */
  readonly timeoutMs: number;
  /** How long a claim holds a row: the outbound timeout plus a margin, so a slow send is never reclaimed (KTD1). */
  readonly leaseMs: number;
}

export const DELIVERY_SETTINGS = Symbol('DELIVERY_SETTINGS');

export const BATCH_SIZE = 10;

/** Covers rendering and recording around the send. */
export const LEASE_MARGIN_MS = 30_000;

export function deliverySettings(pollIntervalMs: number, timeoutMs: number): DeliverySettings {
  return { batchSize: BATCH_SIZE, pollIntervalMs, timeoutMs, leaseMs: timeoutMs + LEASE_MARGIN_MS };
}
