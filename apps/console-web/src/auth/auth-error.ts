/** The `authError` codes console-api (`@repo/bff-core`) puts on the `/?authError=<code>` sign-in failure redirect. */
export const AUTH_ERROR_CODES = ['unavailable', 'login_failed', 'access_denied', 'invalid_state'] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/** `undefined` for anything that is not a known code, so unknown values are ignored. */
export function parseAuthError(value: unknown): AuthErrorCode | undefined {
  return AUTH_ERROR_CODES.find((code) => code === value);
}
