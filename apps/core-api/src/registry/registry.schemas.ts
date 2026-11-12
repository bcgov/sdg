import { SERVICE_CLIENT_ACTIONS } from '@repo/database';
import { z } from 'zod';

/** A Keycloak client id as the registry accepts it: the characters Keycloak client ids use, no slashes or spaces. */
export const clientIdSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._-]+$/, 'Must be a Keycloak client id');

/** POST /api/v1/console/service-clients */
export const addServiceClientSchema = z.object({
  clientId: clientIdSchema,
  displayName: z.string().trim().min(1).max(200),
});
export type AddServiceClient = z.infer<typeof addServiceClientSchema>;

/** A registry entry, as the console routes and GET /api/v1/gateway/me return it. */
export const serviceClientSchema = z.object({
  clientId: z.string(),
  displayName: z.string(),
  enabled: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ServiceClientView = z.infer<typeof serviceClientSchema>;

export const serviceClientListSchema = z.array(serviceClientSchema);

/** One registry change. `actor.name` is the administrator's display name when they made it. */
export const serviceClientEventSchema = z.object({
  id: z.int().positive(),
  clientId: z.string(),
  action: z.enum(SERVICE_CLIENT_ACTIONS),
  actor: z.object({ principalId: z.uuid(), name: z.string() }),
  createdAt: z.iso.datetime(),
});
export type ServiceClientEventView = z.infer<typeof serviceClientEventSchema>;

export const HISTORY_DEFAULT_LIMIT = 50;
export const HISTORY_MAX_LIMIT = 200;

/** GET /api/v1/console/service-clients/history?limit=&before= (before: an event id from `nextBefore`). */
export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(HISTORY_MAX_LIMIT).default(HISTORY_DEFAULT_LIMIT),
  before: z.coerce.number().int().positive().optional(),
});
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

/** The history newest first; pass `nextBefore` as `before` for the next page, null when there is none. */
export const historyPageSchema = z.object({
  events: z.array(serviceClientEventSchema),
  nextBefore: z.int().positive().nullable(),
});
export type HistoryPage = z.infer<typeof historyPageSchema>;
