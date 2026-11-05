import type { AudiencePredicate, AuthUser } from '@repo/auth';

import type { CredentialDirectory, LinkedCredential, PersonRef } from './directories.js';

/** The clients whose tokens notification-api accepts, besides linked credentials (KTD5). */
export interface TokenClients {
  /** notification-api's own Keycloak client: admin and sender-owner tokens. */
  readonly ownClientId: string;
  /** Relaying apps' clients (e.g. the portal): recipient tokens. */
  readonly relayingClientIds: readonly string[];
}

interface PrincipalBase extends PersonRef {
  /** The token's `azp`: the client it was issued to. */
  readonly clientId: string;
  readonly user: AuthUser;
}

/** A client-credentials token of a linked credential. */
export interface CredentialPrincipal extends PrincipalBase {
  readonly kind: 'credential';
  readonly credential: LinkedCredential;
}

/** A person's token issued to notification-api's own client: admin and owner endpoints. */
export interface OwnClientUserPrincipal extends PrincipalBase {
  readonly kind: 'own-client-user';
  /** Holds the `admin` role on the own client (`resource_access.<own client>.roles` or `client_roles`). */
  readonly isAdmin: boolean;
}

/** A person's token issued to a relaying app's client: recipient endpoints. */
export interface RelayingUserPrincipal extends PrincipalBase {
  readonly kind: 'relaying-user';
}

export type Principal = CredentialPrincipal | OwnClientUserPrincipal | RelayingUserPrincipal;
export type TokenKind = Principal['kind'];

export const ADMIN_ROLE = 'admin';
const SERVICE_ACCOUNT_PREFIX = 'service-account-';

const asString = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** `aud` as a list: Keycloak emits a string for one audience and an array for several. */
export function audiences(claims: Readonly<Record<string, unknown>>): string[] {
  const { aud } = claims;
  if (typeof aud === 'string') return [aud];
  return Array.isArray(aud) ? aud.filter((value): value is string => typeof value === 'string') : [];
}

/** Keycloak's client-credentials tokens carry `client_id` and a `service-account-<client>` username. */
export function isServiceAccount(claims: Readonly<Record<string, unknown>>): boolean {
  if (asString(claims['client_id']) !== null) return true;
  return asString(claims['preferred_username'])?.startsWith(SERVICE_ACCOUNT_PREFIX) ?? false;
}

function resourceAccessRoles(claims: Readonly<Record<string, unknown>>, clientId: string): readonly unknown[] {
  const access: unknown = claims['resource_access'];
  if (typeof access !== 'object' || access === null || !Object.hasOwn(access, clientId)) return [];
  const client: unknown = Object.getOwnPropertyDescriptor(access, clientId)?.value;
  if (typeof client !== 'object' || client === null || !('roles' in client)) return [];
  return Array.isArray(client.roles) ? client.roles : [];
}

/**
 * The roles a token holds on `clientId`: Keycloak's `resource_access.<client>.roles`, and the top-level `client_roles`
 * claim BC Gov's SSO service (the standard realm) uses instead. `client_roles` names no client, so it holds the roles
 * of the client the token was issued to: callers pass only the token's own `azp`.
 */
function clientRoles(claims: Readonly<Record<string, unknown>>, clientId: string): readonly unknown[] {
  const topLevel: unknown = claims['client_roles'];
  return [...resourceAccessRoles(claims, clientId), ...(Array.isArray(topLevel) ? topLevel : [])];
}

function isListedClient(clientId: string, clients: TokenClients): boolean {
  return clientId === clients.ownClientId || clients.relayingClientIds.includes(clientId);
}

/**
 * Accepts the audiences of notification-api's own client, each relaying client and every linked credential (KTD5).
 * Credentials are looked up per token, so a newly linked credential needs no restart.
 */
export function acceptedAudience(clients: TokenClients, credentials: CredentialDirectory): AudiencePredicate {
  return async (claims) => {
    const values = audiences(claims);
    if (values.some((value) => isListedClient(value, clients))) return true;
    const linked = await Promise.all(values.map((value) => credentials.findByClientId(value)));
    return linked.some((credential) => credential !== null);
  };
}

/**
 * Tells the token kinds apart from verified claims (KTD5). Null means the token is of no kind notification-api
 * accepts: a user token of a credential's client, a service account that is not a linked credential, or any token
 * issued to another client. notification-api's own and relaying clients are never credentials (R8).
 */
export async function classifyToken(
  user: AuthUser,
  clients: TokenClients,
  credentials: CredentialDirectory,
): Promise<Principal | null> {
  const clientId = asString(user.claims['azp']);
  if (clientId === null) return null;
  const base = { clientId, issuer: user.issuer, subject: user.subject, user };

  if (isServiceAccount(user.claims)) {
    if (isListedClient(clientId, clients)) return null;
    const credential = await credentials.findByClientId(clientId);
    return credential === null ? null : { ...base, kind: 'credential', credential };
  }
  if (clientId === clients.ownClientId) {
    const isAdmin = clientRoles(user.claims, clientId).includes(ADMIN_ROLE);
    return { ...base, kind: 'own-client-user', isAdmin };
  }
  if (clients.relayingClientIds.includes(clientId)) return { ...base, kind: 'relaying-user' };
  return null;
}
