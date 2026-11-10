import { z } from 'zod';

/** POST /internal/principals/login: the principal, and the profile the BFF keeps in its session for /api/auth/me. */
export const loginResponseSchema = z.object({
  principalId: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** GET /api/v1/shared/me. */
export const principalSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
});
export type PrincipalResponse = z.infer<typeof principalSchema>;
