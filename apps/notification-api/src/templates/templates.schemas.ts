import type { Channel } from '@repo/notification-database';
import { z } from 'zod';

import { languageTagSchema } from '../catalog/catalog.schemas.js';
import { CHANNEL_DECLARATIONS, CHANNELS } from '../channels/channels.js';
import { timeZoneSchema } from '../config/env.js';
import { typeKeySchema } from '../senders/senders.schemas.js';

/** Characters per template part, layout or partial. */
export const MAX_SOURCE_LENGTH = 100_000;

const sourceSchema = z.string().max(MAX_SOURCE_LENGTH);

/** Validates a template's parts against its channel's declaration (R21, R44): required parts are not blank. */
export function partsSchema(channel: Channel): z.ZodType<Record<string, string>> {
  const shape = Object.fromEntries(
    CHANNEL_DECLARATIONS[channel].templateParts.map((part) => [
      part.name,
      part.required
        ? sourceSchema.refine((source) => source.trim() !== '', 'Must not be blank')
        : sourceSchema.optional(),
    ]),
  );
  return z
    .strictObject(shape)
    .transform((parts) =>
      Object.fromEntries(Object.entries(parts).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    );
}

export const templateParamsSchema = z.object({
  typeKey: typeKeySchema,
  channel: z.enum(CHANNELS),
  language: languageTagSchema,
});
export type TemplateParams = z.infer<typeof templateParamsSchema>;

export const templateVersionParamsSchema = templateParamsSchema.extend({ version: z.coerce.number().int().min(1) });
export type TemplateVersionParams = z.infer<typeof templateVersionParamsSchema>;

export const saveTemplateSchema = z.object({
  parts: z.record(z.string(), sourceSchema).meta({
    description:
      "The channel's parts. Email: subject, html (MJML), text (optional). In-app: title, body (Markdown), " +
      'actionUrl (optional). Webhook: payload (optional JSON whose string values are Liquid).',
  }),
});
export type SaveTemplate = z.infer<typeof saveTemplateSchema>;

const referencesSchema = z.array(z.string()).meta({ description: 'The layouts and partials it names' });

export const templateVersionSchema = z.object({
  id: z.uuid(),
  typeKey: z.string(),
  channel: z.enum(CHANNELS),
  language: z.string(),
  version: z.int(),
  parts: z.record(z.string(), z.string()),
  references: referencesSchema,
  createdAt: z.iso.datetime(),
});
export type TemplateVersionResponse = z.infer<typeof templateVersionSchema>;

export const templateVersionListSchema = z.array(templateVersionSchema);

export const previewQuerySchema = z.object({
  version: z.coerce.number().int().min(1).optional().meta({ description: 'Default: the current version' }),
  timeZone: timeZoneSchema.optional().meta({ description: 'An IANA zone; default: the platform default zone' }),
});
export type PreviewQuery = z.infer<typeof previewQuerySchema>;

const renderedPartsSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('email'), subject: z.string(), html: z.string(), text: z.string() }),
  z.object({ channel: z.literal('in-app'), title: z.string(), body: z.string(), actionUrl: z.string().nullable() }),
  z.object({ channel: z.literal('webhook'), payload: z.string().meta({ description: 'JSON text' }) }),
]);

export const previewSchema = z.object({
  version: z.int(),
  language: z.string(),
  rendered: renderedPartsSchema,
});
export type PreviewResponse = z.infer<typeof previewSchema>;

/** Layout and partial names appear in `{% layout "name" %}` and `{% include "name" %}`. */
export const fragmentParamsSchema = z.object({
  name: z
    .string()
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Must be lower-case letters, digits, underscores or hyphens'),
});
export type FragmentParams = z.infer<typeof fragmentParamsSchema>;

export const saveFragmentSchema = z.object({ source: sourceSchema.meta({ description: 'Liquid source' }) });
export type SaveFragment = z.infer<typeof saveFragmentSchema>;

export const fragmentVersionSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['layout', 'partial']),
  name: z.string(),
  version: z.int(),
  source: z.string(),
  references: referencesSchema,
  createdAt: z.iso.datetime(),
});
export type FragmentVersionResponse = z.infer<typeof fragmentVersionSchema>;

export const fragmentVersionListSchema = z.array(fragmentVersionSchema);
