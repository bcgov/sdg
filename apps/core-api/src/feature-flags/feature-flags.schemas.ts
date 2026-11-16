import { FEATURE_FLAG_AUDIENCES, FEATURE_FLAG_EVENT_ACTIONS } from '@repo/database';
import { z } from 'zod';

import { cursorPageSchema, cursorQuerySchema, numberedPageSchema, numberedQuerySchema } from '../common/list-query.js';
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

/**
 * GET /api/v1/console/feature-flags (KTD2, R15, R16): search by key or description; `audience` is the app a flag
 * affects (portal or console, each including `both`); `enabled` the switch. Every column sorts, key ascending by
 * default; numbers start descending (R4), and `overridesOn` sorts by the "on" override count.
 */
export const flagListQuerySchema = numberedQuerySchema({
  sort: { key: 'asc', audience: 'asc', enabled: 'desc', rolloutPct: 'desc', overridesOn: 'desc' },
  defaultSort: 'key',
  filters: {
    audience: z.enum(['portal', 'console']).optional(),
    enabled: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  },
});
export type FlagListQuery = z.output<typeof flagListQuerySchema>;
export type FlagSortColumn = FlagListQuery['sort'];

/** A page of flags by the requested order, key breaking ties (R12). */
export const flagPageSchema = numberedPageSchema(flagSummarySchema);
export type FlagPage = z.infer<typeof flagPageSchema>;

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

/** GET /api/v1/console/feature-flag-history?key=&limit=&before=|after= (KTD3): ids from a page's `older` or `newer`. */
export const flagHistoryQuerySchema = cursorQuerySchema({ key: flagKeySchema.optional() });
export type FlagHistoryQuery = z.output<typeof flagHistoryQuerySchema>;

/** The history newest first, with the cursors for the next older and newer pages, null at either end (KTD3). */
export const flagHistoryPageSchema = cursorPageSchema(flagEventSchema);
export type FlagHistoryPage = z.infer<typeof flagHistoryPageSchema>;
