import type { z } from 'zod';

import type { Channel } from './integration-type.js';
import { inAppIntegration } from './types/in-app.js';
import { smtpIntegration } from './types/smtp.js';
import { webhookIntegration } from './types/webhook.js';

/** Every integration type, fixed at build time (R45). */
export const INTEGRATION_TYPES = [smtpIntegration, webhookIntegration, inAppIntegration] as const;

type AnyIntegrationType = (typeof INTEGRATION_TYPES)[number];
export type IntegrationTypeKey = AnyIntegrationType['key'];

/** A type key with its validated configuration, narrowed by `type`. */
export type IntegrationConfig = {
  [T in AnyIntegrationType as T['key']]: { type: T['key']; config: z.output<T['configSchema']> };
}[IntegrationTypeKey];

export function integrationType(key: string): AnyIntegrationType | undefined {
  return INTEGRATION_TYPES.find((type) => type.key === key);
}

/** The keys of the types that deliver `channel`. */
export function typeKeysForChannel(channel: Channel): IntegrationTypeKey[] {
  return INTEGRATION_TYPES.filter((type) => type.channel === channel).map((type) => type.key);
}

/** Validates `config` against `typeKey`'s schema. Throws for an unknown type or an invalid configuration. */
export function parseIntegrationConfig(typeKey: string, config: unknown): IntegrationConfig {
  switch (typeKey) {
    case 'smtp':
      return { type: 'smtp', config: smtpIntegration.configSchema.parse(config) };
    case 'webhook':
      return { type: 'webhook', config: webhookIntegration.configSchema.parse(config) };
    case 'in-app':
      return { type: 'in-app', config: inAppIntegration.configSchema.parse(config) };
    default:
      throw new Error(`Unknown integration type ${typeKey}`);
  }
}
