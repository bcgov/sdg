import { z } from 'zod';

import { pageQuerySchema } from '../history/history.schemas.js';

export const inboxQuerySchema = pageQuerySchema;
export type InboxQuery = z.infer<typeof inboxQuerySchema>;

export const inboxItemParamsSchema = z.object({ itemId: z.uuid() });
export type InboxItemParams = z.infer<typeof inboxItemParamsSchema>;

/**
 * One of the user's in-app items (R50). Content is null when the type had no in-app template in the user's or the
 * default language, or it failed to render.
 */
export const inboxItemSchema = z.object({
  id: z.uuid(),
  notificationId: z.uuid(),
  type: z.string(),
  title: z.string().nullable(),
  /** Sanitized HTML. */
  body: z.string().nullable(),
  actionUrl: z.string().nullable(),
  language: z.string().nullable(),
  readAt: z.iso.datetime().nullable(),
  acknowledgedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type InboxItemResponse = z.infer<typeof inboxItemSchema>;

export const inboxPageSchema = z.object({
  items: z.array(inboxItemSchema),
  nextCursor: z.uuid().nullable(),
});
export type InboxPage = z.infer<typeof inboxPageSchema>;
