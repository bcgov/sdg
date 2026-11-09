import { z } from 'zod';

import { signWebhook } from '../../crypto/signing.js';
import type { GuardedHttpClient } from '../../outbound/http-dispatcher.js';
import type { SendOutcome } from '../../outbound/outcome.js';
import { defineIntegrationType } from '../integration-type.js';

/**
 * The built-in webhook integration: a signed POST to the contact point's URL (KTD10). It takes no configuration, since
 * the URL and its secret belong to the contact point.
 */
export const webhookIntegration = defineIntegrationType({
  key: 'webhook',
  channel: 'webhook',
  configSchema: z.strictObject({}),
  secretFields: [],
});

export interface WebhookMessage {
  /** https, unless the host is allow-listed (R51). */
  url: string;
  /** The endpoint's own `whsec_…` secret (R49). */
  secret: string;
  /** Sent as `webhook-id`, so the receiver can discard repeats (R53). */
  deliveryId: string;
  /** The JSON document, exactly as signed and sent. */
  body: string;
  /** Defaults to now. */
  timestamp?: Date;
}

/** Sends one signed webhook delivery or failure callback. */
export function sendWebhook(http: GuardedHttpClient, message: WebhookMessage): Promise<SendOutcome> {
  const { url, secret, deliveryId, body, timestamp = new Date() } = message;
  const signed = signWebhook({ secret, id: deliveryId, timestamp, body });
  return http.post({ url, headers: { 'content-type': 'application/json', ...signed }, body });
}
