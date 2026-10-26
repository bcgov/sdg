import { z } from 'zod';

/** /login query. A repeated or object `returnTo` falls back to "/" (via safeReturnTo) instead of a 400. */
export const loginQuerySchema = z.object({
  returnTo: z
    .string()
    .optional()
    .catch(undefined)
    .meta({ description: 'Relative path to return to after login; anything else falls back to "/"' }),
});

export type LoginQuery = z.infer<typeof loginQuerySchema>;

export const currentUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email().nullable(),
});

export type CurrentUserResponse = z.infer<typeof currentUserSchema>;

export const logoutResponseSchema = z.object({
  redirectUrl: z.url().meta({ description: 'Keycloak end-session URL, or the portal origin when there is none' }),
});

export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
