import type { DeliveryPolicy, PolicyChannel } from '@repo/notification-database';
import { z } from 'zod';

/** The channels a policy governs. In-app is never one: every recipient with an inbox gets the in-app item (R38). */
export const POLICY_CHANNELS = ['email', 'webhook'] as const satisfies readonly PolicyChannel[];

/** A year: delays beyond it are typos, and they keep a step's due time well inside what a Date can hold. */
export const MAX_DELAY_MINUTES = 525_600;

const policyChannelSchema = z.enum(POLICY_CHANNELS, {
  error: (issue) =>
    issue.input === 'in-app'
      ? 'In-app is not a policy channel: every recipient with an inbox always gets the in-app item (R38)'
      : 'Must be email or webhook',
});

const allAtOnceSchema = z.strictObject({
  mode: z.literal('all-at-once'),
  channels: z
    .array(policyChannelSchema)
    .superRefine((channels, ctx) => {
      for (const [index, channel] of channels.entries()) {
        if (channels.indexOf(channel) !== index) {
          ctx.addIssue({ code: 'custom', message: `${channel} is listed more than once`, path: [index] });
        }
      }
    })
    .meta({ description: 'Delivered together. Empty means the in-app item only.' }),
});

const escalationStepSchema = z.strictObject({
  channel: policyChannelSchema,
  delayMinutes: z.int().min(0).max(MAX_DELAY_MINUTES).meta({
    description: "Minutes after the previous step's final status, or after the in-app item for the first step (KTD8)",
  }),
});

const escalationSchema = z.strictObject({
  mode: z.literal('escalation'),
  steps: z.array(escalationStepSchema).min(1),
});

/**
 * A Notification type's delivery policy (R14): every channel at once, or ordered escalation steps that an in-app read
 * or acknowledgement cancels (R18). Each step's delay runs from the previous step's final status (KTD8).
 */
export const policySchema = z.discriminatedUnion('mode', [
  allAtOnceSchema,
  escalationSchema,
]) satisfies z.ZodType<DeliveryPolicy>;

/**
 * The policy's distinct channels, in order. Escalation applies only to recipients with an inbox, so address-only
 * recipients get these all at once (R19).
 */
export function policyChannels(policy: DeliveryPolicy): PolicyChannel[] {
  const channels = policy.mode === 'all-at-once' ? policy.channels : policy.steps.map((step) => step.channel);
  return [...new Set(channels)];
}
