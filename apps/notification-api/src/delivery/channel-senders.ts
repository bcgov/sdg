import { Inject, Injectable } from '@nestjs/common';

import type { ResolvedIntegration } from '../integrations/platform-defaults.js';
import { sendEmail } from '../integrations/types/smtp.js';
import { sendWebhook } from '../integrations/types/webhook.js';
import { GuardedHttpClient } from '../outbound/http-dispatcher.js';
import { OutboundGuard } from '../outbound/outbound-guard.js';
import { failed, type SendOutcome } from '../outbound/outcome.js';
import type { UsableContactPoint } from '../recipients/contact-points.service.js';
import type { RenderedParts } from '../templates/renderer.js';
import { DELIVERY_SETTINGS, type DeliverySettings } from './settings.js';

/** One rendered delivery to hand to its integration. */
export interface ChannelMessage {
  /** The stable delivery ID: the email Message-ID and the `webhook-id` (R53). */
  readonly deliveryId: string;
  readonly integration: ResolvedIntegration;
  readonly point: UsableContactPoint;
  readonly rendered: RenderedParts;
}

/**
 * Sends a rendered delivery through the integration resolved for this attempt (KTD9): SMTP through the outbound
 * guard for email, a signed request to the endpoint for webhooks (KTD10, KTD12). Every send has the one outbound
 * timeout the lease is sized from (KTD1).
 */
@Injectable()
export class ChannelSenders {
  private readonly guard: OutboundGuard;
  private readonly http: GuardedHttpClient;
  private readonly settings: DeliverySettings;

  constructor(
    @Inject(OutboundGuard) guard: OutboundGuard,
    @Inject(GuardedHttpClient) http: GuardedHttpClient,
    @Inject(DELIVERY_SETTINGS) settings: DeliverySettings,
  ) {
    this.guard = guard;
    this.http = http;
    this.settings = settings;
  }

  send({ deliveryId, integration, point, rendered }: ChannelMessage): Promise<SendOutcome> {
    if (integration.type === 'smtp' && rendered.channel === 'email') {
      const { subject, html, text } = rendered;
      return sendEmail(
        this.guard,
        integration.config,
        { to: point.address, subject, html, text, messageId: deliveryId },
        { timeoutMs: this.settings.timeoutMs },
      );
    }
    if (integration.type === 'webhook' && rendered.channel === 'webhook') {
      if (!point.signingSecret) return Promise.resolve(failed(false, 'The endpoint has no signing secret'));
      return sendWebhook(this.http, {
        url: point.address,
        secret: point.signingSecret,
        deliveryId,
        body: rendered.payload,
      });
    }
    return Promise.resolve(failed(false, `The ${integration.type} integration cannot deliver ${rendered.channel}`));
  }
}
