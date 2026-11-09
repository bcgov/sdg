import { z } from 'zod';

import { pageQuerySchema } from '../history/history.schemas.js';

export const inboxQuerySchema = pageQuerySchema.extend({
  unread: z.stringbool().optional().meta({ description: 'Only items not yet read' }),
});
export type InboxQuery = z.infer<typeof inboxQuerySchema>;

export const inboxItemParamsSchema = z.object({ itemId: z.uuid() });
export type InboxItemParams = z.infer<typeof inboxItemParamsSchema>;

/** Any string: an id that is not a uuid is as missing as one that is not the caller's (R18). */
export const byNotificationParamsSchema = z.object({ notificationId: z.string() });
export type ByNotificationParams = z.infer<typeof byNotificationParamsSchema>;

export const unreadCountSchema = z.object({ unread: z.number().int().min(0) });
export type UnreadCount = z.infer<typeof unreadCountSchema>;

/** How many unread items one "mark all as read" marked (R20). */
export const readAllSchema = z.object({ marked: z.number().int().min(0) });
export type ReadAll = z.infer<typeof readAllSchema>;

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
  /** The body as plain text, cut on a word boundary to at most 140 characters; null when the body is. */
  excerpt: z.string().nullable(),
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
