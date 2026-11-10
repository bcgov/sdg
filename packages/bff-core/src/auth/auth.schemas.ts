import { z } from 'zod';

export interface LoginQuery {
  returnTo?: string | undefined;
}

/** /login query. A repeated or object `returnTo` falls back to "/" (via safeReturnTo) instead of a 400. */
export const loginQuerySchema: z.ZodType<LoginQuery> = z.object({
  returnTo: z
    .string()
    .optional()
    .catch(undefined)
    .meta({ description: 'Relative path to return to after login; anything else falls back to "/"' }),
});

export interface CurrentUserResponse {
  id: string;
  name: string;
  email: string | null;
}

export const currentUserSchema: z.ZodType<CurrentUserResponse> = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email().nullable(),
});

export interface LogoutResponse {
  redirectUrl: string;
}

export const logoutResponseSchema: z.ZodType<LogoutResponse> = z.object({
  redirectUrl: z.url().meta({ description: "Keycloak end-session URL, or the app's origin when there is none" }),
});
