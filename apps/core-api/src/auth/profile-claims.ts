/**
 * Profile claims the portal's Settings page reads live from userinfo and that must never be stored (R17, R19):
 * sign-in leaves them out of the identity record, and the BFF session must never hold them.
 */
export const PROFILE_CLAIMS: ReadonlySet<string> = new Set([
  'birthdate',
  'gender',
  'address',
  'phone_number',
  'phone_number_verified',
]);

/**
 * Warns when a verified token carries profile claims (KTD8). Keycloak's built-in profile, address and phone mappers add
 * them to the ID and access tokens by default, and the BFFs keep those tokens in their sessions, so a token carrying
 * them means the realm is storing what Settings deliberately never stores. Logs the claim keys only, never the values.
 */
export function warnOnTokenProfileClaims(
  logger: { warn: (message: unknown) => void },
  claims: Readonly<Record<string, unknown>>,
): void {
  const present = Object.keys(claims)
    .filter((key) => PROFILE_CLAIMS.has(key))
    .toSorted((a, b) => a.localeCompare(b));
  if (present.length === 0) return;
  logger.warn({
    msg: 'A verified token carries profile claims; set the Keycloak mappers to userinfo only',
    claims: present,
  });
}
