import { FEATURE_FLAG_AUDIENCES } from '@repo/database';
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

/** Which app a person signs in to, from their identities' sign-in markers (KTD5). */
export const personKindSchema = z.enum(['resident', 'console-user']);
export type PersonKind = z.infer<typeof personKindSchema>;

export const PEOPLE_SEARCH_LIMIT = 20;

/** POST /api/v1/console/people/search: a partial name or email, and the flag audience to search within (KTD9). */
export const peopleSearchSchema = z.object({
  query: z.string().trim().min(2),
  audience: z.enum(FEATURE_FLAG_AUDIENCES),
});
export type PeopleSearch = z.infer<typeof peopleSearchSchema>;

/** A person found by search: `resident` once they signed in to the portal, otherwise `console-user` (KTD5). */
export const personSchema = z.object({
  principalId: z.uuid(),
  displayName: z.string(),
  email: z.string().nullable(),
  kind: personKindSchema,
  lastSignInAt: z.iso.datetime(),
});
export type PersonView = z.infer<typeof personSchema>;

/** At most PEOPLE_SEARCH_LIMIT people by name; `more` when others also matched. */
export const peopleSearchResultSchema = z.object({
  results: z.array(personSchema),
  more: z.boolean(),
});
export type PeopleSearchResult = z.infer<typeof peopleSearchResultSchema>;
