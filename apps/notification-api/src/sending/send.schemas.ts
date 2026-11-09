import { NOTIFICATION_STATUSES } from '@repo/notification-database';
import { z } from 'zod';

import { addressSettingsSchema, senderEmailPointSchema, systemIdSchema } from '../recipients/recipients.schemas.js';
import { ownerSchema, typeKeySchema } from '../senders/senders.schemas.js';

/**
 * The largest send body accepted, which also bounds template data. Express's JSON parser enforces it for every
 * route, with a 413 for anything larger.
 */
export const SEND_BODY_LIMIT = '256kb';

/** A user by issuer + subject, pre-registered for the sender when unknown, with the sender's contact points (R27). */
const userRecipientSchema = ownerSchema.extend({
  kind: z.literal('user'),
  contactPoints: z
    .array(senderEmailPointSchema)
    .max(10)
    .default([])
    .meta({ description: "Used only for this sender's deliveries, without verification (R33, R35)" }),
});

/** One of the sender's own systems (R33). */
const systemRecipientSchema = z.object({ kind: z.literal('system'), systemId: systemIdSchema });

/** A raw address: the sender's address-only recipient for it, created when new (R27, R39). */
const addressRecipientSchema = addressSettingsSchema.extend({
  kind: z.literal('address'),
  reference: z
    .string()
    .min(1)
    .max(200)
    .nullable()
    .optional()
    .meta({ description: "The sender's own reference for the person, such as a form id" }),
});

export const sendRecipientSchema = z.discriminatedUnion('kind', [
  userRecipientSchema,
  systemRecipientSchema,
  addressRecipientSchema,
]);
export type SendRecipient = z.infer<typeof sendRecipientSchema>;

export const audienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('recipients'), recipients: z.array(sendRecipientSchema).min(1) }),
  z.object({
    kind: z.literal('topic'),
    topicId: z.uuid().meta({ description: 'A topic of the sender, or a platform topic it was granted (R15, R16)' }),
  }),
  z.object({
    kind: z
      .literal('everyone')
      .meta({ description: "The sender's registered users, systems and topic subscribers (R30)" }),
  }),
]);
export type Audience = z.infer<typeof audienceSchema>;

export const sendSchema = z.object({
  type: typeKeySchema,
  data: z.record(z.string(), z.unknown()).meta({ description: "Checked against the type's data contract" }),
  idempotencyKey: z
    .string()
    .min(1)
    .max(255)
    .meta({ description: 'Per sender, for 24 hours: a replay returns the original notification (KTD13)' }),
  audience: audienceSchema,
});
export type SendRequest = z.infer<typeof sendSchema>;

export const sendResponseSchema = z.object({
  notificationId: z.uuid(),
  status: z.enum(NOTIFICATION_STATUSES),
});
export type SendResponse = z.infer<typeof sendResponseSchema>;
