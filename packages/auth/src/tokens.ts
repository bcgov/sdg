/** Readers for Keycloak token claims, applied to claims a verifier has already checked. */

type Claims = Readonly<Record<string, unknown>>;

const SERVICE_ACCOUNT_PREFIX = 'service-account-';

const asString = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** `aud` as a list: Keycloak emits a string for one audience and an array for several. */
export function audiences(claims: Claims): string[] {
  const { aud } = claims;
  return typeof aud === 'string' ? [aud] : strings(aud);
}

/** Keycloak's client-credentials tokens carry `client_id` and a `service-account-<client>` username. */
export function isServiceAccount(claims: Claims): boolean {
  if (asString(claims['client_id']) !== null) return true;
  return asString(claims['preferred_username'])?.startsWith(SERVICE_ACCOUNT_PREFIX) ?? false;
}

function resourceAccessRoles(claims: Claims, clientId: string): string[] {
  const access: unknown = claims['resource_access'];
  if (typeof access !== 'object' || access === null || !Object.hasOwn(access, clientId)) return [];
  const client: unknown = Object.getOwnPropertyDescriptor(access, clientId)?.value;
  if (typeof client !== 'object' || client === null || !('roles' in client)) return [];
  return strings(client.roles);
}

/**
 * The roles a token holds on `clientId`: Keycloak's `resource_access.<client>.roles`, and the top-level `client_roles`
 * claim BC Gov's SSO service (the standard realm) uses instead. `client_roles` names no client, so it holds the roles
 * of the client the token was issued to: it counts only when `clientId` is the token's own `azp`.
 */
export function clientRoles(claims: Claims, clientId: string): string[] {
  const own = asString(claims['azp']) === clientId ? strings(claims['client_roles']) : [];
  return [...resourceAccessRoles(claims, clientId), ...own];
}
