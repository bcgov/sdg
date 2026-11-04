import { z } from 'zod';

import { CHANNELS } from '../channels/channels.js';
import { senderParamsSchema } from '../senders/senders.schemas.js';
import { inAppIntegration } from './types/in-app.js';
import { smtpConfigSchema } from './types/smtp.js';
import { webhookIntegration } from './types/webhook.js';

export const channelParamsSchema = senderParamsSchema.extend({ channel: z.enum(CHANNELS) });
export type ChannelParams = z.infer<typeof channelParamsSchema>;

/** One entry per registered type (registry.ts): the type key selects the configuration schema (R45). */
export const putIntegrationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('smtp'), config: smtpConfigSchema }),
  z.strictObject({ type: z.literal('webhook'), config: webhookIntegration.configSchema }),
  z.strictObject({ type: z.literal('in-app'), config: inAppIntegration.configSchema }),
]);
export type PutIntegration = z.infer<typeof putIntegrationSchema>;

export const integrationSchema = z.object({
  id: z.uuid(),
  channel: z.enum(CHANNELS),
  type: z.string(),
  version: z.number().int().meta({ description: 'Goes up on every change' }),
  config: z.record(z.string(), z.unknown()).meta({ description: 'The configuration without its secret fields' }),
  secretFieldsSet: z.array(z.string()).meta({ description: 'Secret fields that are set; their values are never read' }),
});
export type IntegrationResponse = z.infer<typeof integrationSchema>;
