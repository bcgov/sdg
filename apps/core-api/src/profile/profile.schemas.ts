import { z } from 'zod';

/**
 * GET /api/v1/portal/profile: the resident's profile, read live from userinfo and never stored (R17). A claim
 * userinfo leaves out is `null`; `birthdate` and `gender` are the claims as released, for the web app to format.
 */
export const profileSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  birthdate: z.string().nullable(),
  gender: z.string().nullable(),
  /** The address as display lines. */
  address: z.array(z.string()).nullable(),
});
export type ProfileResponse = z.infer<typeof profileSchema>;
