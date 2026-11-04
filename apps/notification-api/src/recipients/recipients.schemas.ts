import { z } from 'zod';

import { languageTagSchema, topicSchema } from '../catalog/catalog.schemas.js';
import { timeZoneSchema } from '../config/env.js';
import { ownerSchema } from '../senders/senders.schemas.js';
import { normalizeEmail } from './normalize.js';

/** An email address in its stored form (KTD17): trimmed and lower-cased before it is checked. */
export const emailAddressSchema = z
  .string()
  .max(320)
  .overwrite(normalizeEmail)
  .refine((value) => z.email().safeParse(value).success, 'Must be an email address')
  .meta({ description: 'An email address; stored trimmed and lower-cased' });

const nullableLanguage = languageTagSchema.nullable();
const nullableTimeZone = timeZoneSchema.nullable().meta({ description: 'An IANA time zone, e.g. America/Vancouver' });

const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a 24-hour local time, HH:MM')
  .meta({ description: 'A local time, HH:MM' });

/** When email and due escalation steps wait, in the recipient's timezone (R40). */
export const quietHoursSchema = z
  .object({ start: localTime, end: localTime })
  .refine((hours) => hours.start !== hours.end, { message: 'start and end must differ', path: ['end'] });
export type QuietHours = z.infer<typeof quietHoursSchema>;

// Recipient endpoints

export const settingsSchema = z.object({
  id: z.uuid(),
  language: z.string().nullable(),
  timeZone: z.string().nullable(),
  quietHours: quietHoursSchema.nullable(),
  channels: z.array(
    z.object({
      channel: z.enum(['in-app', 'email']),
      enabled: z.boolean(),
      /** In-app cannot be switched off (R37). */
      switchable: z.boolean(),
    }),
  ),
});
export type SettingsResponse = z.infer<typeof settingsSchema>;

export const updateSettingsSchema = z.object({
  language: nullableLanguage.optional(),
  timeZone: nullableTimeZone.optional(),
  quietHours: quietHoursSchema.nullable().optional(),
});
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;

/** The channels a user has settings for; webhooks go only to systems (R33). */
export const channelParamsSchema = z.object({ channel: z.enum(['in-app', 'email']) });
export type ChannelParams = z.infer<typeof channelParamsSchema>;

export const channelSwitchSchema = z.object({ enabled: z.boolean() });
export type ChannelSwitch = z.infer<typeof channelSwitchSchema>;

export const contactPointParamsSchema = z.object({ contactPointId: z.uuid() });
export type ContactPointParams = z.infer<typeof contactPointParamsSchema>;

export const addContactPointSchema = z.object({ channel: z.literal('email'), address: emailAddressSchema });
export type AddContactPoint = z.infer<typeof addContactPointSchema>;

export const editContactPointSchema = z.object({ address: emailAddressSchema });
export type EditContactPoint = z.infer<typeof editContactPointSchema>;

/** One of the user's own contact points. Points senders supplied are never shown (R33). */
export const contactPointSchema = z.object({
  id: z.uuid(),
  channel: z.literal('email'),
  address: z.string(),
  /** False until the address is confirmed through the link sent to it (R35). */
  verified: z.boolean(),
  source: z.enum(['idp', 'user']),
});
export type ContactPointResponse = z.infer<typeof contactPointSchema>;

export const contactPointListSchema = z.array(contactPointSchema);

export const subscriptionListSchema = z.array(topicSchema);

// Sender endpoints

export const senderEmailPointSchema = z.object({ channel: z.literal('email'), address: emailAddressSchema });

export const preRegisterUserSchema = ownerSchema.extend({
  contactPoints: z
    .array(senderEmailPointSchema)
    .max(10)
    .default([])
    .meta({ description: "Used only for this sender's deliveries, without verification (R33, R35)" }),
});
export type PreRegisterUser = z.infer<typeof preRegisterUserSchema>;

/** The same whether the user was new or already known (R33). */
export const preRegisteredUserSchema = ownerSchema;

export const systemIdSchema = z.string().min(1).max(200).meta({ description: "The sender's id for the system" });

export const registerSystemSchema = z.object({
  systemId: systemIdSchema,
  webhookUrls: z
    .array(z.url({ protocol: /^https?$/, error: 'Must be an https:// URL' }))
    .min(1)
    .max(10)
    .meta({ description: 'https only; http only to a host on the outbound allow-list (R51)' }),
});
export type RegisterSystem = z.infer<typeof registerSystemSchema>;

export const systemRecipientSchema = z.object({
  systemId: z.string(),
  webhooks: z.array(
    z.object({
      id: z.uuid(),
      url: z.string(),
      secret: z
        .string()
        .nullable()
        .meta({
          description:
            'The endpoint’s Standard Webhooks signing secret (`whsec_…`), shown only in the response that created ' +
            'the endpoint; null for an endpoint registered before',
        }),
    }),
  ),
});
export type SystemRecipientResponse = z.infer<typeof systemRecipientSchema>;

export const addressSettingsSchema = z.object({
  channel: z.literal('email'),
  address: emailAddressSchema,
  language: nullableLanguage.optional(),
  timeZone: nullableTimeZone.optional(),
});
export type AddressSettings = z.infer<typeof addressSettingsSchema>;

export const addressRecipientSchema = z.object({
  channel: z.literal('email'),
  address: z.string(),
  language: z.string().nullable(),
  timeZone: z.string().nullable(),
});
export type AddressRecipientResponse = z.infer<typeof addressRecipientSchema>;

/** A user by issuer + subject, or one of the sender's systems by its id (R27). */
export const recipientRefSchema = z.union([ownerSchema.strict(), z.strictObject({ systemId: systemIdSchema })]);
export type RecipientRef = z.infer<typeof recipientRefSchema>;

// Public confirm endpoint

export const confirmSchema = z.object({
  token: z.string().min(1).max(200).meta({ description: 'The token from the confirmation link' }),
});
export type Confirm = z.infer<typeof confirmSchema>;
