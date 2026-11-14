import { FEATURE_FLAG_AUDIENCES, FEATURE_FLAG_EVENT_ACTIONS } from '@repo/database';
import { z } from 'zod';

import { personKindSchema } from '../principals/principals.schemas.js';

export { personKindSchema };
export type { PersonKind } from '../principals/principals.schemas.js';

/** GET /api/v1/shared/flags: each flag that is on for the caller, mapped to true. A key it doesn't name is off (R10). */
export const flagListSchema = z.record(z.string(), z.literal(true));
export type FlagList = z.infer<typeof flagListSchema>;

/** GET /api/v1/shared/hello-world, when `hello_world` is on for the caller. */
export const helloWorldSchema = z.object({ message: z.literal('Hello, world!') });
export type HelloWorld = z.infer<typeof helloWorldSchema>;

/** A flag key (KTD13): lower case, starting with a letter, 2–63 characters. Keys never change (R2). */
export const flagKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,62}$/, 'Must start with a lower-case letter, then 1–62 lower-case letters, digits or _');

/** The `:key` route parameter. */
export const flagKeyParam = { schema: flagKeySchema };

/** Trimmed, at most 500 characters; an empty description is stored as null (KTD13). */
const descriptionSchema = z.string().trim().max(500).nullable();
const rolloutPctSchema = z.int().min(0).max(100);
const audienceSchema = z.enum(FEATURE_FLAG_AUDIENCES);

/** POST /api/v1/console/feature-flags. Omitted fields take the table defaults: off, 100%, portal. */
export const createFlagSchema = z.object({
  key: flagKeySchema,
  description: descriptionSchema.optional(),
  enabled: z.boolean().optional(),
  rolloutPct: rolloutPctSchema.optional(),
  audience: audienceSchema.optional(),
});
export type CreateFlag = z.infer<typeof createFlagSchema>;

/** PATCH /api/v1/console/feature-flags/:key: only the fields to change. The key can't be changed (R2). */
export const updateFlagSchema = z.strictObject({
  description: descriptionSchema.optional(),
  enabled: z.boolean().optional(),
  rolloutPct: rolloutPctSchema.optional(),
  audience: audienceSchema.optional(),
});
export type UpdateFlag = z.infer<typeof updateFlagSchema>;

/** A flag with its override counts: how many people it is forced on and off for (R21). */
export const flagSummarySchema = z.object({
  key: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  rolloutPct: z.int(),
  audience: audienceSchema,
  overrideCounts: z.object({ on: z.int().nonnegative(), off: z.int().nonnegative() }),
});
export type FlagSummary = z.infer<typeof flagSummarySchema>;

export const flagSummaryListSchema = z.array(flagSummarySchema);

/** PUT /api/v1/console/feature-flags/:key/overrides/:principalId */
export const setOverrideSchema = z.object({ enabled: z.boolean() });
export type SetOverride = z.infer<typeof setOverrideSchema>;

/** One person's override of a flag, with their current name, email and kind. */
export const overrideSchema = z.object({
  principalId: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  kind: personKindSchema,
  enabled: z.boolean(),
});
export type OverrideView = z.infer<typeof overrideSchema>;

/** GET /api/v1/console/feature-flags/:key: the flag and every override, whatever its kind. */
export const flagDetailSchema = flagSummarySchema.extend({ overrides: z.array(overrideSchema) });
export type FlagDetail = z.infer<typeof flagDetailSchema>;

const fieldValueSchema = z.union([z.string(), z.number(), z.boolean()]).nullable();

/** `{ field: { from, to } }` per changed field (null where a value didn't exist), or a delete's `overridesRemoved`. */
export const flagChangesSchema = z.record(
  z.string(),
  z.union([z.object({ from: fieldValueSchema, to: fieldValueSchema }), z.int()]),
);

/** One change to a flag or override (KTD7). `actor.name` is a snapshot; `subject.name` is the target's current name. */
export const flagEventSchema = z.object({
  id: z.int().positive(),
  flagKey: z.string(),
  action: z.enum(FEATURE_FLAG_EVENT_ACTIONS),
  actor: z.object({ principalId: z.uuid(), name: z.string() }),
  subject: z.object({ principalId: z.uuid(), name: z.string().nullable() }).nullable(),
  changes: flagChangesSchema,
  createdAt: z.iso.datetime(),
});
export type FlagEventView = z.infer<typeof flagEventSchema>;

export const FLAG_HISTORY_DEFAULT_LIMIT = 50;
export const FLAG_HISTORY_MAX_LIMIT = 200;

/** GET /api/v1/console/feature-flag-history?key=&limit=&before= (before: an event id from `nextBefore`). */
export const flagHistoryQuerySchema = z.object({
  key: flagKeySchema.optional(),
  limit: z.coerce.number().int().min(1).max(FLAG_HISTORY_MAX_LIMIT).default(FLAG_HISTORY_DEFAULT_LIMIT),
  before: z.coerce.number().int().positive().optional(),
});
export type FlagHistoryQuery = z.infer<typeof flagHistoryQuerySchema>;

/** The history newest first; pass `nextBefore` as `before` for the next page, null when there is none. */
export const flagHistoryPageSchema = z.object({
  events: z.array(flagEventSchema),
  nextBefore: z.int().positive().nullable(),
});
export type FlagHistoryPage = z.infer<typeof flagHistoryPageSchema>;
