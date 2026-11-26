import { apiRequest } from '../api/http';

/** The resident's profile as core-api reads it live from userinfo (GET /api/v1/portal/profile). Never stored (R17). */
export interface Profile {
  name: string | null;
  email: string | null;
  phoneNumber: string | null;
  /** `YYYY-MM-DD` as released, formatted for display by `formatBirthdate`. */
  birthdate: string | null;
  /** As released, labelled for display by `formatGender`. */
  gender: string | null;
  /** Display lines. */
  address: string[] | null;
}

export const PROFILE_PATH = '/api/v1/portal/profile';

const STRING_FIELDS = ['name', 'email', 'phoneNumber', 'birthdate', 'gender'] as const;

const isNullableString = (value: unknown): boolean => typeof value === 'string' || value === null;

function isProfile(value: unknown): value is Profile {
  if (typeof value !== 'object' || value === null) return false;
  const fields: Record<string, unknown> = { ...value };
  if (!STRING_FIELDS.every((field) => isNullableString(fields[field]))) return false;
  const { address } = fields;
  return address === null || (Array.isArray(address) && address.every((line) => typeof line === 'string'));
}

/**
 * Any non-2xx answer rejects with an `ApiError`: a 401 (the session ended) goes to sign-in through
 * `useSessionEndedRedirect`, and anything else shows Settings' error state (R14).
 */
export async function fetchProfile(): Promise<Profile> {
  const body = await apiRequest(PROFILE_PATH);
  if (!isProfile(body)) throw new Error(`GET ${PROFILE_PATH} returned an unexpected body`);
  return body;
}
