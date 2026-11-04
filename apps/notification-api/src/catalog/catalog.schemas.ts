import { z } from 'zod';

import { typeKeySchema } from '../senders/senders.schemas.js';
import { dataContractSchema } from './data-contract.js';
import { policySchema } from './policy.js';

/** Keys appear in paths and in templates' context, so they are lower-case slugs. */
const keySchema = z
  .string()
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Must be lower-case letters, digits, dots, underscores or hyphens');

const nameSchema = z.string().trim().min(1).max(200);

/** The canonical form of a BCP 47 language tag (`en-ca` becomes `en-CA`), or null when it is not one. */
export function canonicalLanguage(tag: string): string | null {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export const languageTagSchema = z
  .string()
  .max(35)
  .refine((tag) => canonicalLanguage(tag) !== null, 'Must be a BCP 47 language tag, such as en-CA')
  .overwrite((tag) => canonicalLanguage(tag) ?? tag)
  .meta({ description: 'A BCP 47 language tag, such as en-CA; stored in canonical form' });

export const typeParamsSchema = z.object({ typeKey: typeKeySchema });
export type TypeParams = z.infer<typeof typeParamsSchema>;

export const createTypeSchema = z.object({
  key: keySchema.meta({ description: 'The Notification type key senders are granted and send by' }),
  displayName: nameSchema,
  dataContract: dataContractSchema,
  defaultLanguage: languageTagSchema,
  policy: policySchema,
});
export type CreateType = z.infer<typeof createTypeSchema>;

export const typeSchema = z.object({
  key: z.string(),
  displayName: z.string(),
  dataContract: dataContractSchema,
  defaultLanguage: z.string(),
  policy: policySchema,
});
export type TypeResponse = z.infer<typeof typeSchema>;

export const typeListSchema = z.array(typeSchema);

export const topicParamsSchema = z.object({ topicId: z.uuid() });
export type TopicParams = z.infer<typeof topicParamsSchema>;

export const broadcasterParamsSchema = topicParamsSchema.extend({ senderId: z.uuid() });
export type BroadcasterParams = z.infer<typeof broadcasterParamsSchema>;

export const createTopicSchema = z.object({
  key: keySchema.meta({ description: "Unique among platform topics, or within the sender's topics" }),
  name: nameSchema,
  selfSubscribe: z
    .boolean()
    .default(false)
    .meta({ description: 'Whether recipients may subscribe and unsubscribe themselves (R17)' }),
});
export type CreateTopic = z.infer<typeof createTopicSchema>;

export const topicSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  scope: z.enum(['platform', 'sender']).meta({ description: 'Created by the admin (R15) or by a sender (R16)' }),
  selfSubscribe: z.boolean(),
});
export type TopicResponse = z.infer<typeof topicSchema>;

export const topicListSchema = z.array(topicSchema);

export const platformTopicSchema = topicSchema.extend({
  broadcasters: z.array(z.uuid()).meta({ description: 'The senders granted permission to broadcast (R15)' }),
});
export type PlatformTopicResponse = z.infer<typeof platformTopicSchema>;

export const platformTopicListSchema = z.array(platformTopicSchema);
