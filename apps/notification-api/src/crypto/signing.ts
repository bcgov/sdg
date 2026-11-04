import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Standard Webhooks v1 (KTD10): HMAC-SHA256 over `<webhook-id>.<webhook-timestamp>.<body>`, keyed by the base64 part
 * of a `whsec_…` secret. Each endpoint has its own secret, so a receiver can verify only its own deliveries (R49).
 */
const SECRET_PREFIX = 'whsec_';
const SIGNATURE_VERSION = 'v1';

export interface WebhookHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
}

/** A new signing secret: `whsec_` and 32 random bytes in base64. */
export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString('base64')}`;
}

function secretKey(secret: string): Buffer {
  if (!secret.startsWith(SECRET_PREFIX)) throw new Error('A webhook signing secret starts with whsec_');
  return Buffer.from(secret.slice(SECRET_PREFIX.length), 'base64');
}

function signature(secret: string, id: string, timestamp: string, body: string): string {
  return createHmac('sha256', secretKey(secret)).update(`${id}.${timestamp}.${body}`).digest('base64');
}

export interface SignWebhookInput {
  secret: string;
  /** The delivery's stable ID, so a receiver can discard repeats (R53). */
  id: string;
  timestamp: Date;
  /** The exact bytes sent as the request body. */
  body: string;
}

/** The three headers a signed webhook request carries. */
export function signWebhook({ secret, id, timestamp, body }: SignWebhookInput): WebhookHeaders {
  const seconds = String(Math.floor(timestamp.getTime() / 1000));
  return {
    'webhook-id': id,
    'webhook-timestamp': seconds,
    'webhook-signature': `${SIGNATURE_VERSION},${signature(secret, id, seconds, body)}`,
  };
}

export interface VerifyWebhookInput {
  secret: string;
  headers: WebhookHeaders;
  body: string;
}

/**
 * What a receiver does: true when one of the space-separated `v1,<signature>` entries matches. It does not check the
 * timestamp's age; a receiver applies its own tolerance.
 */
export function verifyWebhook({ secret, headers, body }: VerifyWebhookInput): boolean {
  const expected = Buffer.from(signature(secret, headers['webhook-id'], headers['webhook-timestamp'], body));
  return headers['webhook-signature'].split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== SIGNATURE_VERSION || value === undefined) return false;
    const candidate = Buffer.from(value);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}
